/*
 * DTrace metric for postgres querys
 */
var mod_ca = require('../../../../lib/ca/ca-common');

var desc = {
    module: 'postgres',
    stat: 'queries',
    fields: [ 'hostname', 'zonename', 'pid', 'execname', 'psargs',
	'querysubstr', 'latency', 'cputime' ],
    metad: {
	probedesc: [
	    {
		probes: [ 'postgres*:::query-start' ],
		gather: {
			querysubstr: {
				gather: 'substr(copyinstr(arg0), 0, 32)',
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
		probes: [ 'postgres*:::query-done' ],
		aggregate: {
			querysubstr: 'count()',
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
			latency: '$0',
			cputime: '$0'
		}
	    },
	    {
	        probes: [ 'postgres*:::query-done' ],
		clean: {
			querysubstr: '$0',
			latency: '$0',
			cputime: '$0'
		}
	    }
	],
	usepragmazone: true
    }
};

exports.cadMetricDesc = desc;
