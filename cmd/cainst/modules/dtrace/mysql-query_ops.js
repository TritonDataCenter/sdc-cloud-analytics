/*
 * DTrace metric for mysql querys
 */
var mod_ca = require('../../../../lib/ca/ca-common');

var desc = {
    module: 'mysql',
    stat: 'queries',
    fields: [ 'hostname', 'zonename', 'pid', 'execname', 'psargs',
	'querysubstr', 'database', 'user', 'client', 'latency', 'cputime' ],
    metad: {
	probedesc: [
	    {
		probes: [ 'mysql*:::query-start' ],
		gather: {
			querysubstr: {
				gather: 'substr(copyinstr(arg0), 0, 6)',
				store: 'thread'
			}, database: {
				gather: 'copyinstr(arg2)',
				store: 'thread'
			}, user: {
				gather: 'copyinstr(arg3)',
				store: 'thread'
			}, client: {
				gather: 'copyinstr(arg4)',
				store: 'thread'
			}, latency: {
				gather: 'timestamp',
				store: 'thread'
			}, cputime: {
				gather: 'vtimestamp',
				store: 'thread'
			}
		}
	    },
	    {
		probes: [ 'mysql*:::query-done' ],
		aggregate: {
			querysubstr: 'count()',
			database: 'count()',
			user: 'count()',
			client: 'count()',
			latency: 'llquantize($0, 10, 3, 11, 100)',
			cputime: 'llquantize($0, 10, 3, 11, 100)',
			hostname: 'count()',
			default: 'count()',
			zonename: 'count()',
			pid: 'count()',
			execname: 'count()',
			psargs: 'count()'
		},
		transforms: {
			querysubstr: 'strjoin($0, "...")',
			database: '$0',
			user: '$0',
			client: '$0',
			latency: 'timestamp - $0',
			cputime: 'vtimestamp - $0',
			hostname:
			    '"' + mod_ca.caSysinfo().ca_hostname + '"',
			zonename: 'zonename',
			pid: 'lltostr(pid)',
			execname: 'execname',
			psargs: 'curpsinfo->pr_psargs'
		},
		verify: {
			querysubstr: '$0',
			database: '$0',
			user: '$0',
			client: '$0',
			latency: '$0',
			cputime: '$0'
		}
	    },
	    {
		probes: [ 'mysql*:::query-done' ],
		clean: {
			querysubstr: '$0',
			database: '$0',
			user: '$0',
			client: '$0',
			latency: '$0',
			cputime: '$0'
		}
	    }
	],
	usepragmazone: true
    }
};

exports.cadMetricDesc = desc;
