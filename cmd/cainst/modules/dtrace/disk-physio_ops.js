/*
 * DTrace metric for I/O operations.
 */
var mod_ca = require('../../../../lib/ca/ca-common');

var desc = {
    module: 'disk',
    stat: 'physio_ops',
    label: 'operations',
    type: 'ops',
    fields: {
	hostname: {
	    label: 'hostname',
	    type: mod_ca.ca_type_string
	},
	optype: {
	    label: 'type',
	    type: mod_ca.ca_type_string
	},
	latency: {
	    label: 'latency',
	    type: mod_ca.ca_type_latency
	},
	size: {
	    label: 'size',
	    type: mod_ca.ca_type_number
	},
	disk: {
	    label: 'disk',
	    type: mod_ca.ca_type_string
	},
	offset: {
	    label: 'block offset',
	    type: mod_ca.ca_type_number
	}
    },
    metad: {
	probedesc: [ {
	    probes: [ 'io:::start' ],
	    gather: {
		latency: {
		    gather: 'timestamp',
		    store: 'global[arg0]'
		}
	    }
	}, {
	    probes: [ 'io:::done' ],
	    aggregate: {
		optype: 'count()',
		hostname: 'count()',
		latency: 'llquantize($0, 10, 3, 11, 100)',
		size: 'llquantize($0, 10, 3, 11, 100)',
		disk: 'count()',
		offset: 'llquantize($0, 10, 0, 11, 100)',
		default: 'count()'
	    },
	    transforms: {
		optype: '(args[0]->b_flags & B_READ ? "read" : "write")',
		hostname: '"' + mod_ca.caSysinfo().ca_hostname + '"',
		latency: 'timestamp - $0[arg0]',
		disk: 'args[1]->dev_statname',
		size: 'args[0]->b_bcount',
		offset: 'args[0]->b_blkno'
	    },
	    verify: {
		latency: '$0[arg0]'
	    },
	    predicate: 'args[1]->dev_name == "sd" || ' +
		'args[1]->dev_name == "cmdk"'
	}, {
	    probes: [ 'io:::done' ],
	    clean: {
		latency: '$0[arg0]'
	    }
	} ]
    }
};

exports.cadMetricDesc = desc;
