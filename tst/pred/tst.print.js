/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var mod_capred = require('../../lib/ca/ca-pred');

var test_cases = [
	{},
	{
		eq: [ 'execname', 'mplayer' ]
	},
	{
		ne: [ 'execname', 'vlc' ]
	},
	{
		lt: [ 'latency', 42 ]
	},
	{
		gt: [ 'latency', 23 ]
	},
	{
		le: [ 'latency', 42 ]
	},
	{
		ge: [ 'latency', 23 ]
	},
	{
		and: [ {}, { eq: [ 'latency', 23 ] } ]
	},
	{
		or: [ { eq: [ 'latency', 23 ] }, {} ]
	}
];

function main()
{
	var ii;

	for (ii = 0; ii < test_cases.length; ii++) {
		console.log(mod_capred.caPredPrint(test_cases[ii]));
	}
}

main();
