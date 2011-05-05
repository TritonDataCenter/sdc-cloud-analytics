/*
 * caconfigsvc: Cloud Analytics Configuration Service
 *
 * This service is responsible for directing other components of the cloud
 * analytics service, including instrumenters and aggregators.
 */

var mod_cainst = require('../lib/ca/ca-inst');
var mod_dbg = require('../lib/ca/ca-dbg');

var cc_svc;

function main()
{
	var args;

	mod_dbg.caEnablePanicOnCrash();

	args = process.argv.slice(2);
	args.unshift('./metadata');

	cc_svc = new mod_cainst.caConfigService(args);

	caDbg.set('service', cc_svc);

	cc_svc.start(function (err) {
		if (err)
			caPanic('failed to start service', err);
	});
}

main();
