/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * caconfigsvc: Cloud Analytics Configuration Service
 *
 * This service is responsible for directing other components of the cloud
 * analytics service, including instrumenters and aggregators.
 */

var mod_svc = require('../lib/ca/ca-svc-config');
var mod_dbg = require('../lib/ca/ca-dbg');

var cc_svc;

function main()
{
	var args;

	mod_dbg.caEnablePanicOnCrash();

	args = process.argv.slice(2);
	args.unshift('./metadata');

	cc_svc = new mod_svc.caConfigService(args);

	caDbg.set('service', cc_svc);

	cc_svc.start(function (err) {
		if (err)
			caPanic('failed to start service', err);
	});
}

main();
