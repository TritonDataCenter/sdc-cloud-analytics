/*
 * castashsvc: Cloud Analytics Stash (Persistence) service
 */

var mod_stash = require('../lib/ca/ca-svc-stash');
var mod_dbg = require('../lib/ca/ca-dbg');

var cs_svc;

function main()
{
	mod_dbg.caEnablePanicOnCrash();
	cs_svc = new mod_stash.caStashService(process.argv.slice(2));
	caDbg.set('service', cs_svc);
	cs_svc.start(function (err) {
		if (err)
			throw (err);
	});
}

main();
