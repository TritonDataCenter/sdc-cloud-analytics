#!/usr/bin/env node
/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * caprof: tool to validate and examine profiles
 */

var mod_sys = require('sys');
var mod_fs = require('fs');

var mod_ca = require('../lib/ca/ca-common');
var mod_profile = require('../lib/ca/ca-profile');

var cpUsageMessage = [
    'usage: caprof <filename>',
    '',
    '    Validate a metric profile.'
].join('\n');

function main(argv)
{
	var contents, profile, result;

	if (argv.length < 1)
		usage('no filename specified');

	try {
		contents = mod_fs.readFileSync(argv[0]);
	} catch (ex) {
		fail('error: failed to read file: ' + ex);
	}

	try {
		profile = JSON.parse(contents);
	} catch (ex) {
		fail('error: failed to parse JSON: ' + ex);
	}

	result = validate(profile);

	if (result === 0) {
		console.log('%s okay', argv[0]);
	} else {
		console.log('%s has errors', argv[0]);
	}

	return (result);
}

function usage(err)
{
	var msg = '';

	if (err)
		msg += 'error: ' + err + '\n';

	msg += cpUsageMessage;
	fail(msg);
}

function fail(message)
{
	process.stderr.write(message + '\n');
	process.exit(1);
}

function validate(profile)
{
	var errors, ii;

	errors = mod_profile.caProfileValidate(profile);

	for (ii = 0; ii < errors.length; ii++)
		console.log('error: ' + errors[ii].message);

	return (errors.length === 0 ? 0 : 1);
}

process.exit(main(process.argv.slice(2)));
