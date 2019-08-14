const selenium = require("selenium-webdriver"),
    AxeBuilder = require("axe-webdriverjs"),
    fs = require('fs'),
    { Parser } = require('json2csv'),
    site = process.argv[2],
    filename = 'audit-'+site+'.csv';

if(typeof site === 'undefined') {
    console.log('ERROR: Please provide a 3rd parameter of what domain to check')

    return 0;
}

const menu = JSON.parse(fs.readFileSync('/vagrant/'+site+'/styleguide/menu.json'));

const removeExceptions = items => {
    let exceptions = [
        "#q" // https://www.w3.org/WAI/tutorials/forms/labels/#hiding-label-text
    ];

    return items.filter(
        item => item.nodes.filter(node => !exceptions.includes(node.target[0])).length !== 0
    );
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
    const urls = [];

    for (var item in menu) {
        urls.push('http://'+site+'.wayne.local'+menu[item].relative_url);
    }
    
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
            .analyze()
            .then(function (results) {
                if (results.violations.length > 0) {
                    errors = removeExceptions(results.violations);

                    if(errors.length > 0) {
                        // Append values for the report
                        for (let [key, error] of Object.entries(errors)) {
                            errors[key].failureSummary = error.nodes[0].failureSummary;
                            errors[key].target = error.nodes[0].target;
                            errors[key].url = url;
                            delete errors[key].nodes;
                        }

                        const parser = new Parser();
                        const csv = parser.parse(errors);

                        console.log(errors.length+' violations found.');

                        fs.appendFile(filename, csv, function(err) {
                            if(err) {
                                return console.error(err);
                            }
                        });
                    }
                } else {
                    console.log('0 violations found.');
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

// Get an array of URLs to analyze
const urls = getUrls(menu['101']['submenu'], site);

// Analyze all pages
const analyze = analyzePages(urls);

analyze.then(response => {
    console.log('The report was saved to '+filename);
});
