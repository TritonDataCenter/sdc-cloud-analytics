/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * A simple script that gathers the ps information for a given process using the
 * CA Proc data manager.
 */

var mod_assert = require('assert');
var mod_proc = require('../../lib/ca/ca-proc.js');
var mod_tl = require('../../lib/tst/ca-test');

var g_pid;
var g_back;
var timeout = 1 * 1000; /* 1 s */

function createBackend()
{
	mod_proc.caProcLoadCTF(function (err, ctype) {
		if (err) {
			process.stderr.write(caSprintf('failed to load CTF ' +
			    'data: %r', err));
			process.exit(1);
		}

		g_back = new mod_proc.caProcDataCache(ctype, timeout);
		mod_tl.advance();
	});
}

function getData()
{
	g_back.data(function (objs) {
		if (!(g_pid in objs)) {
			process.stderr.write(caSprintf('pid %d missing from ' +
			    'data\n', g_pid));
			process.exit(1);
		}

		process.stdout.write(caSprintf('pid %d: %j\n', g_pid,
		    objs[g_pid]));
	});
}

function setup()
{
	var pid;

	if (process.argv.length !== 3) {
		process.stderr.write('ps.js: pid\n');
		process.exit(1);
	}

	pid = parseInt(process.argv[2], 10);
	if (pid === NaN || pid < 0) {
		process.stderr.write('ps.js: pid is not a valid id\n');
		process.exit(1);
	}

	g_pid = pid;
	mod_tl.advance();
}

/*
 * Push functions
 */
mod_tl.ctPushFunc(setup);
mod_tl.ctPushFunc(createBackend);
mod_tl.ctPushFunc(getData);
mod_tl.advance();
