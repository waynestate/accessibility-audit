const selenium = require("selenium-webdriver"),
    AxeBuilder = require("axe-webdriverjs"),
    fs = require('fs'),
    { Parser } = require('json2csv'),
    site = process.argv[2],
    single = process.argv[3],
    filename = 'audit-'+site+'.csv';

if(typeof site === 'undefined') {
    console.log('ERROR: Please provide a 3rd parameter of what domain to check')

    return 0;
}

function removeExceptions(items) {
    let config = JSON.parse(fs.readFileSync('/vagrant/'+site+'/axe.config.json'));
    let exceptions = config.base.concat(config.local);

    items = items.filter(item => ! exceptions.includes(item.target[0]));

    return items;
};

const setupDriver = selenium => {
    const chromeCapabilities = selenium.Capabilities.chrome();
    chromeCapabilities.set('chromeOptions', {
        'args': ['--headless', '--disable-gpu']
    });

    driver = new selenium.Builder().withCapabilities(chromeCapabilities).forBrowser("chrome").build();

    return driver;
};

function getUrls(menu, site) {
    let urls = [];

    const parseElements = items => {
        items.forEach(element => {
            url = 'http://'+site+'.wayne.local'+element.relative_url;

            // Only push in unique URLs
            if (urls.indexOf(url) === -1) {
                urls.push(url);
            }

            // Recurse through submenu items
            const submenu_items = Object.values(element.submenu);
            if (submenu_items.length > 0) {
                parseElements(submenu_items);
            }
        });
    };

    parseElements(menu);

    return urls;
};

async function analyzePages(urls) {
    console.log(urls.length+' page(s) to analyze.');

    for (let [key, url] of Object.entries(urls)) {
        console.log('Analyzing... '+url);

        // Check the URL
        driver = setupDriver(selenium);
        driver.get(url);

        // Check for accessibility errors
        await AxeBuilder(driver)
            .options({
                runOnly: {
                  type: 'tag',
                  values: ['wcag2a', 'wcag21aa', 'best-practice']
                },
                'rules': {
                  'color-contrast': { enabled: true }
                },
                resultTypes: ['violations', 'incomplete'],
                reporter: 'v2',
              })
            .exclude('iframe') // Since the content inside them can be dyanmic and hard to individually filter
            .exclude('#hero') // Since our hero area has a gradient and dynamic content it is hard to individually filter
            .analyze()
            .then(function (results) {
                // Combine incomplete (needs review) and violations
                errors = results.violations.concat(results.incomplete);

                // Errors to report
                report = [];

                if (errors.length > 0) {
                    // Build the report
                    errors.forEach(function (error) {
                        error.nodes.forEach(function (node) {
                            violation = {
                                "url": url,
                                "description": error.description,
                                "html": node.html,
                                "target": node.target,
                            }

                            report.push(violation);
                        });
                    });

                    // Handle exceptions to the report
                    report = removeExceptions(report);

                    if(report.length > 0) {
                        const parser = new Parser();
                        const csv = parser.parse(report);
    
                        console.log(report.length+' violations found.');
    
                        fs.appendFile(filename, csv, function(err) {
                            if(err) {
                                return console.error(err);
                            }
                        });
                    } else {
                        console.log('Pass');
                    }     
                }

                driver.quit();
            })
            .catch(err => {
                console.error(err);

                driver.quit();
            });
    }

    return urls;
}

// Remove the file if it already exists so we start with a fresh report
if(fs.existsSync(filename)) {
    fs.unlink(filename, function(err) {
        if(err) throw err;
    });
}

// Get the site menu
const menu = Object.values(JSON.parse(fs.readFileSync('/vagrant/'+site+'/styleguide/menu.json')));

// Get an array of URLs to analyze
if(typeof single === 'undefined') {
    urls = getUrls(menu, site);
} else {
    urls = [single];
}

// Analyze all pages
const analyze = analyzePages(urls);

analyze.then(response => {
    console.log('The report was saved to '+filename);
});
