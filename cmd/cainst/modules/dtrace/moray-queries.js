/*
 * DTrace metric for Moray SQL queries
 */
var mod_ca = require('../../../../lib/ca/ca-common');

var desc = {
    module: 'moray',
    stat: 'queries',
    fields: [ 'hostname', 'zonename', 'pid', 'execname', 'psargs',
	'querysubstr', 'latency', 'cputime' ],
    metad: {
	probedesc: [
	    {
		probes: [ 'moray*:::query-start' ],
		gather: {
			querysubstr: {
				gather: 'substr(copyinstr(arg1), 0, 10)',
				store: 'global[pid,copyinstr(arg0)]'
			},
			latency: {
				gather: 'timestamp',
				store: 'global[pid,copyinstr(arg0)]'
			},
			cputime: {
				gather: 'vtimestamp',
				store: 'global[pid,copyinstr(arg0)]'
			}
		}
	    },
	    {
		probes: [ 'moray*:::query-done' ],
		aggregate: {
			latency: 'llquantize($0, 10, 3, 11, 100)',
			cputime: 'llquantize($0, 10, 3, 11, 100)',
			hostname: 'count()',
			default: 'count()',
			zonename: 'count()',
			pid: 'count()',
			execname: 'count()',
			psargs: 'count()',
			querysubstr: 'count()'
		},
		transforms: {
			latency: 'timestamp - $0[pid,copyinstr(arg0)]',
			cputime: 'vtimestamp - $0[pid,copyinstr(arg0)]',
			hostname:
			    '"' + mod_ca.caSysinfo().ca_hostname + '"',
			zonename: 'zonename',
			pid: 'lltostr(pid)',
			execname: 'execname',
			psargs: 'curpsinfo->pr_psargs',
			querysubstr: 'strjoin($0[pid,copyinstr(arg0)], "...")'
		},
		verify: {
			querysubstr: '$0[pid,copyinstr(arg0)]',
			latency: '$0[pid,copyinstr(arg0)]',
			cputime: '$0[pid,copyinstr(arg0)]'
		}
	    },
	    {
		probes: [ 'moray*:::query-done' ],
		clean: {
			querysubstr: '$0[pid,copyinstr(arg0)]',
			latency: '$0[pid,copyinstr(arg0)]',
			cputime: '$0[pid,copyinstr(arg0)]'
		}
	    }
	],
	usepragmazone: true
    }
};

exports.cadMetricDesc = desc;
