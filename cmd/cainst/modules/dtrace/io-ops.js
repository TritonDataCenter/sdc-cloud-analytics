/*
 * DTrace metric for I/O operations.
 */
var mod_ca = require('../../../../lib/ca/ca-common');

var desc = {
    module: 'io',
    stat: 'ops',
    label: 'operations',
    type: 'ops',
    fields: {
	hostname: { label: 'hostname', type: mod_ca.ca_type_string },
	zonename: { label: 'zone name', type: mod_ca.ca_type_string },
	optype: { label: 'type', type: mod_ca.ca_type_string },
	execname: { label: 'application name',
	    type: mod_ca.ca_type_string },
	latency: { label: 'latency', type: mod_ca.ca_type_latency },
	pid: { label: 'process identifier', type: mod_ca.ca_type_string }
    },
    metad: {
	probedesc: [ {
	    probes: [ 'io:::start' ],
	    gather: {
		zonename: {
		    gather: 'zonename',
		    store: 'global[arg0]'
		}, execname: {
		    gather: 'execname',
		    store: 'global[arg0]'
		}, latency: {
		    gather: 'timestamp',
		    store: 'global[arg0]'
		}, pid: {
		    gather: 'pid',
		    store: 'global[arg0]'
		}
	    }
	}, {
	    probes: [ 'io:::done' ],
	    aggregate: {
		zonename: 'count()',
		optype: 'count()',
		hostname: 'count()',
		execname: 'count()',
		latency: 'llquantize($0, 10, 3, 11, 100)',
		pid: 'count()',
		default: 'count()'
	    },
	    transforms: {
		zonename: '$0[arg0]',
		optype: '(args[0]->b_flags & B_READ ? "read" : "write")',
		hostname: '"' + mod_ca.caSysinfo().ca_hostname + '"',
		execname: '$0[arg0]',
		latency: 'timestamp - $0[arg0]',
		pid: 'lltostr($0[arg0])'
	    },
	    verify: {
		zonename: '$0[arg0]',
		execname: '$0[arg0]',
		latency: '$0[arg0]',
		pid: '$0[arg0]'
	    }
	}, {
	    probes: [ 'io:::done' ],
	    clean: {
		execname: '$0[arg0]',
		zonename: '$0[arg0]',
		latency: '$0[arg0]',
		pid: '$0[arg0]'
	    }
	} ]
    }
};

exports.cadMetricDesc = desc;
