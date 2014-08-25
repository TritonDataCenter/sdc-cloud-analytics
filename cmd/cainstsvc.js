/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

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
	var args, backends, ii;

	mod_dbg.caEnablePanicOnCrash();

	args = process.argv.slice(2);
	backends = [ 'kstat', 'dtrace', 'zfs', 'cainstr', 'proc' ];
	for (ii = 0; ii < args.length; ii++) {
		if (args[ii] == '-b') {
			/* "-b backend1,backend2,..." form */
			if (ii == args.length - 1)
				backends = [];
			else
				backends = args[ii + 1].split(',');

			args = args.slice(ii + 2);
			break;
		}

		if (caStartsWith(args[ii], '-b')) {
			/* "-bbackend1,backend2,..." form */
			backends = args[ii].substr(2).split(',');
			args = args.slice(ii + 1);
			break;
		}
	}

	console.log('using backends %s', backends);
	args.unshift('./metadata');
	ii_svc = new mod_instrsvc.caInstrService(args, process.stdout,
	    backends);
	caDbg.set('service', ii_svc);

	ii_svc.start(function (err) {
		if (err)
			caPanic('failed to start service', err);
	});
}

main();
