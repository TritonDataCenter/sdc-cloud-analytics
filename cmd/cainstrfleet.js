/*
 * cainstrfleet: Cloud Analytics Instrumenter Fleet
 *
 * This agent essentially launches a fleet of instrumenters to simulate a large
 * number of compute nodes.
 */

var mod_fs = require('fs');
var mod_path = require('path');

var mod_instrsvc = require('../lib/ca/ca-svc-instr');
var mod_ca = require('../lib/ca/ca-common');
var mod_dbg = require('../lib/ca/ca-dbg');

var ii_svcs;
var ii_usage = [
    'usage: node cainstrfleet.js <logdir> <ninstrs>',
    '',
    'Launches a fleet of <ninstrs> instrumenters, each logging to a file in ' +
    '<logdir>.'
].join('\n');

function iiUsage()
{
	console.error(ii_usage);
	process.exit(1);
}

function main()
{
	var host, args, logdir, ninstrs, ii, instrhost, out, funcs;

	mod_dbg.caEnablePanicOnCrash();

	host = mod_ca.caSysinfo().ca_hostname;
	args = process.argv.slice(2);

	if (args.length < 2)
		iiUsage();

	logdir = args.shift();
	ninstrs = parseInt(args.shift(), 10);

	if (isNaN(ninstrs) || ninstrs < 1)
		iiUsage();

	ii_svcs = {};
	caDbg.set('services', ii_svcs);

	for (ii = 0; ii < ninstrs; ii++) {
		out = mod_fs.createWriteStream(
		    mod_path.join(logdir, instrhost + '.out'));

		instrhost = caSprintf('%s%04d', host, ii);
		process.env['HOST'] = instrhost;
		ii_svcs[instrhost] = new mod_instrsvc.caInstrService(
		    [ './metadata' ], out, [ 'fake' ]);
	}

	funcs = Object.keys(ii_svcs).map(function (svcname, jj) {
		return (function (unused, callback) {
			instrhost = caSprintf('%s%04d', host, jj);
			process.env['HOST'] = instrhost;
			ii_svcs[svcname].start(function (err) {
				if (err) {
					console.error(caSprintf(
					    'FAILED to start %s: %j', svcname,
					    err));
				} else {
					console.log('STARTED %s', svcname);
				}

				callback(err);
			});
		});
	});

	caRunStages(funcs, null, function (err) {
		if (err)
			caPanic('aborting due to one or more errors');

		console.log('startup complete');
	});
}

main();
