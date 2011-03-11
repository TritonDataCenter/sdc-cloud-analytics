/*
 * DTrace metric node.js garbage collection operations
 */
var mod_ca = require('../../../../lib/ca/ca-common');

var desc = {
    module: 'node',
    stat: 'gc_ops',
    label: 'garbage collection operations',
    type: 'ops',
    fields: {
	type: { label: 'gc type', type: mod_ca.ca_type_string },
	latency: { label: 'latency', type: mod_ca.ca_type_latency },
	zonename: { label: 'zone name', type: mod_ca.ca_type_string },
	hostname: { label: 'hostname', type: mod_ca.ca_type_string },
	pid: { label: 'process identifier', type: mod_ca.ca_type_string }
    },
    metad: {
	probedesc: [
	    {
		probes: [ 'node*:::gc-start' ],
		gather: {
			latency: {
				gather: 'timestamp',
				store: 'thread'
			}
		}
	    },
	    {
		probes: [ 'node*:::gc-done' ],
		aggregate: {
			type: 'count()',
			latency: 'llquantize($0, 10, 3, 11, 100)',
			default: 'count()',
			hostname: 'count()',
			zonename: 'count()',
			pid: 'count()'
		},
		transforms: {
			hostname:
			    '"' + mod_ca.caSysinfo().ca_hostname + '"',
			type: '(arg0 == 1 ? "scavenge" : (arg0 == 2 ? ' +
			    '"mark and sweep" : "scavenge and mark and ' +
			    'sweep."))',
			latency: 'timestamp - $0',
			zonename: 'zonename',
			pid: 'lltostr(pid)'
		},
		verify: {
			latency: '$0'
		}
	    },
	    {
		probes: [ 'node*:::gc-done' ],
		clean: {
			latency: '$0'
		}
	    }
	],
	usepragmazone: true
    }
};

exports.cadMetricDesc = desc;
