/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * jsonchk: tool to validate JSON files
 */

var mod_fs = require('fs');

var cpUsageMessage = [
    'usage: jsonchk <filename>',
    '',
    '    Validate a JSON file.'
].join('\n');

var filename;

function main(argv)
{
	if (argv.length < 1)
		usage('no filename specified');

	filename = argv[0];
	mod_fs.readFile(filename, function (err, data) {
		if (err)
			throw (err);

		try {
			JSON.parse(data);
			console.log('validated %s okay', filename);
		} catch (ex) {
			fail(filename + ': illegal JSON: ' + ex.message);
		}
	});
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

main(process.argv.slice(2));
