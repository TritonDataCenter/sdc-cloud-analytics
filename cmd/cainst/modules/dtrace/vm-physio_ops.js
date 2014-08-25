/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * DTrace metric for I/O operations.
 */
var mod_ca = require('../../../../lib/ca/ca-common');

var desc = {
    module: 'vm',
    stat: 'physio_ops',
    fields: [ 'hostname', 'zonename', 'optype', 'latency', 'size', 'offset',
	'errno' ],
    metad: {
	probedesc: [ {
	    probes: [ 'sdt:::zvol-uio-start' ],
	    gather: {
		latency: {
		    gather: 'timestamp',
		    store: 'thread'
		}, size: {
		    gather: '((uio_t *)arg1)->uio_resid',
		    store: 'thread'
		}, offset: {
		    gather: 'sizeof (long) == 8 ? ((uio_t *)arg1)' +
			'->_uio_offset._f : ((uio_t *)arg1)->_uio_offset._p._l',
		    store: 'thread'
		}
	    }
	}, {
	    probes: [ 'sdt:::zvol-uio-done' ],
	    aggregate: {
		optype: 'count()',
		hostname: 'count()',
		latency: 'llquantize($0, 10, 3, 11, 100)',
		size: 'llquantize($0, 10, 3, 11, 100)',
		zonename: 'count()',
		offset: 'llquantize($0, 10, 0, 11, 100)',
		default: 'count()',
		errno: 'count()'
	    },
	    transforms: {
		optype: '(arg2 != 1 ? "read" : "write")',
		hostname: '"' + mod_ca.caSysinfo().ca_hostname + '"',
		zonename: 'zonename',
		latency: 'timestamp - $0',
		size: '$0',
		offset: '$0',
		errno: 'lltostr(arg3, 16)'
	    },
	    verify: {
		latency: '$0',
		size: '$0',
		offset: '$0'
	    }
	}, {
	    probes: [ 'sdt:::zvol-uio-done' ],
	    clean: {
		latency: '$0',
		size: '$0',
		offset: '$0'
	    }
	} ]
    }
};

exports.cadMetricDesc = desc;
