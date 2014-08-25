/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

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
