/*
 * DTrace metric for system calls by operation.
 */
var mod_ca = require('../../../../lib/ca/ca-common');

var desc = {
    module: 'syscall',
    stat: 'ops',
    label: 'syscalls',
    type: 'ops',
    fields: {
	hostname: { label: 'hostname', type: mod_ca.ca_type_string },
	zonename: { label: 'zone name', type: mod_ca.ca_type_string },
	syscall: { label: 'system call', type: mod_ca.ca_type_string },
	pid: { label: 'process identifier', type: mod_ca.ca_type_string },
	execname: { label: 'application name',
	    type: mod_ca.ca_type_string },
	latency: { label: 'latency', type: mod_ca.ca_type_latency }
    },
    metad: {
	probedesc: [
	    {
		probes: [ 'syscall:::entry' ],
		gather: {
			latency: {
				gather: 'timestamp',
				store: 'thread'
			}
		}
	    },
	    {
		probes: [ 'syscall:::return' ],
		aggregate: {
			default: 'count()',
			zonename: 'count()',
			syscall: 'count()',
			hostname: 'count()',
			pid: 'count()',
			execname: 'count()',
			latency: 'llquantize($0, 10, 3, 11, 100)'
		},
		transforms: {
			hostname:
			    '"' + mod_ca.caSysinfo().ca_hostname + '"',
			zonename: 'zonename',
			execname: 'execname',
			syscall: 'probefunc',
			pid: 'lltostr(pid)',
			latency: 'timestamp - $0'
		},
		verify: {
			latency: '$0'
		}
	    },
	    {
		probes: [ 'syscall:::return' ],
		clean: {
			latency: '$0'
		}
	    }
	]
    }
};

exports.cadMetricDesc = desc;
