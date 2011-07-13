/*
 * DTrace metric for mysql querys
 *
 * The intent is to trace all queries, but this is harder to do than it sounds.
 * It needs to trace three types of queries:
 *
 * A) Query commands that are parsed and executed.
 * B) Query commands that return from the query cache (no parse, no exec).
 * C) Prepared statement commands that execute a query (exec only).
 *
 * There is no single probe pair to trace all of these.  These are the probes
 * that fire for each case:
 *
 * A) query-start, query-exec-start, query-exec-done, query-done
 * B) query-start, query-done
 * C) query-exec-start, query-exec-done
 *
 * This makes the most basic metric - mysql queries - difficult to measure
 * since counting query-done + query-exec-done will overcount the (A) type.
 * To solve this, a bitmask is created (field "parsed") so that in the done
 * probes each of the three types can be identified.
 *
 * It's assumed that only (A) type queries are actually "parsed", which is
 * what that field is ultimately used to convey.
 */
var mod_ca = require('../../../../lib/ca/ca-common');

var desc = {
    module: 'mysql',
    stat: 'queries',
    fields: [ 'hostname', 'zonename', 'pid', 'execname', 'psargs',
	'querysubstr', 'database', 'user', 'client', 'parsed', 'status',
	'latency', 'cputime' ],
    metad: {
	probedesc: [
	    {
		probes: [ 'mysql*:::query-start' ],
		alwaysgather: {
			parsed: {
				gather: '1',
				store: 'thread'
			}
		},
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
		probes: [ 'mysql*:::query-exec-start' ],
		alwaysgather: {
			parsed: {
				gather: 'self->parsed0 |= 2',
				store: 'thread'
			}
		},
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
			parsed: 'count()',
			status: 'count()',
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
			parsed: '$0 == 3 ? "yes" : "no"',
			status: 'arg0 == 0 ? "success" : "fail"',
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
			parsed: '$0',
			latency: '$0',
			cputime: '$0'
		},
		predicate: '$parsed0 & 1'
	    },
	    {
		probes: [ 'mysql*:::query-exec-done' ],
		aggregate: {
			querysubstr: 'count()',
			database: 'count()',
			user: 'count()',
			client: 'count()',
			parsed: 'count()',
			status: 'count()',
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
			parsed: '"no"',
			status: 'arg0 == 0 ? "success" : "fail"',
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
			parsed: '$0',
			latency: '$0',
			cputime: '$0'
		},
		predicate: '($parsed0 & 1) == 0'
	    },
	    {
		probes: [ 'mysql*:::query-done', 'mysql*:::query-exec-done' ],
		clean: {
			querysubstr: '$0',
			database: '$0',
			user: '$0',
			client: '$0',
			parsed: '$0',
			latency: '$0',
			cputime: '$0'
		},
		predicate: '($parsed0 & 1) == 0 || probename == "query-done"'
	    }
	],
	usepragmazone: true
    }
};

exports.cadMetricDesc = desc;
