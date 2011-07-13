/*
 * DTrace metric for mysql statements
 */
var mod_ca = require('../../../../lib/ca/ca-common');

var probelist = [ 'select', 'insert', 'insert-select', 'update',
    'multi-update', 'delete', 'multi-delete' ];
var entryprobes = probelist.map(function (x) {
    return (caSprintf('mysql*:::%s-start', x));
});
var returnprobes = probelist.map(function (x) {
    return (caSprintf('mysql*:::%s-done', x));
});

var desc = {
    module: 'mysql',
    stat: 'statements',
    fields: [ 'hostname', 'zonename', 'pid', 'execname', 'psargs',
	'statement', 'status', 'rowsmatched', 'rowschanged', 'latency',
	'cputime' ],
    metad: {
	probedesc: [
	    {
		probes: entryprobes,
		gather: {
			latency: {
				gather: 'timestamp',
				store: 'thread'
			}, cputime: {
				gather: 'vtimestamp',
				store: 'thread'
			}
		}
	    },
	    {
		probes: returnprobes,
		aggregate: {
			statement: 'count()',
			status: 'count()',
			rowsmatched: 'llquantize($0, 10, 0, 7, 100)',
			rowschanged: 'llquantize($0, 10, 0, 7, 100)',
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
			statement: 'substr(probename, 0, strrchr(probename, ' +
			    '\'-\') - probename)',
			status: 'arg0 == 0 ? "success" : "fail"',
			rowsmatched: 'arg1',
			rowschanged: 'probename == "update-done" || ' +
			    'probename == "multi-update-done" ? arg2 : 0',
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
			latency: '$0',
			cputime: '$0'
		}
	    },
	    {
		probes: returnprobes,
		clean: {
			statement: '$0',
			rowsmatched: '$0',
			rowschanged: '$0',
			latency: '$0',
			cputime: '$0'
		}
	    }
	],
	usepragmazone: true
    }
};

exports.cadMetricDesc = desc;
