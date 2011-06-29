/*
 * cainstsvc: Cloud Analytics Instrumenter service
 *
 * This agent runs on compute nodes to gather CA data on-demand.
 */

var mod_instrsvc = require('../lib/ca/ca-svc-instr');
var mod_dbg = require('../lib/ca/ca-dbg');

var ii_svc;

function main()
{
	var args;

	mod_dbg.caEnablePanicOnCrash();

	args = process.argv.slice(2);
	args.unshift('./metadata');
	ii_svc = new mod_instrsvc.caInstrService(args, process.stdout,
	    [ 'kstat', 'dtrace', 'zfs' ]);
	caDbg.set('service', ii_svc);

	ii_svc.start(function (err) {
		if (err)
			caPanic('failed to start service', err);
	});
}

main();
