/*
 * DTrace metric for Moray operations
 */
var mod_ca = require('../../../../lib/ca/ca-common');

/*
 * We explicitly enumerate the operations we're interested in here.  We skip
 * 'batch' because we'll catch its individual operations separately.
 */
var ops = [
    'delobject',
    'findobjects',
    'getobject',
    'putobject',
    'update'
];

var startProbes = ops.map(
    function (op) { return ('moray*:::' + op + '-start'); });
var doneProbes = ops.map(
    function (op) { return ('moray*:::' + op + '-done'); });

var desc = {
    module: 'moray',
    stat: 'ops',
    fields: [ 'hostname', 'zonename', 'pid', 'execname', 'psargs',
	'optype', 'table', 'latency', 'cputime' ],
    metad: {
	probedesc: [
	    /* Non-batch operations */
	    {
		probes: startProbes,
		gather: {
			optype: {
				gather: 'strtok(probename, "-")',
				store: 'global[pid,arg0]'
			},
			table: {
				gather: 'copyinstr(arg2)',
				store: 'global[pid,arg0]'
			},
			latency: {
				gather: 'timestamp',
				store: 'global[pid,arg0]'
			},
			cputime: {
				gather: 'vtimestamp',
				store: 'global[pid,arg0]'
			}
		}
	    },
	    {
		probes: doneProbes,
		aggregate: {
			optype: 'count()',
			table: 'count()',
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
			optype: '$0[pid,arg0]',
			table: '$0[pid,arg0]',
			latency: 'timestamp - $0[pid,arg0]',
			cputime: 'vtimestamp - $0[pid,arg0]',
			hostname:
			    '"' + mod_ca.caSysinfo().ca_hostname + '"',
			zonename: 'zonename',
			pid: 'lltostr(pid)',
			execname: 'execname',
			psargs: 'curpsinfo->pr_psargs'
		},
		verify: {
			optype: '$0[pid,arg0]',
			table: '$0[pid,arg0]',
			latency: '$0[pid,arg0]',
			cputime: '$0[pid,arg0]'
		}
	    },
	    {
		probes: doneProbes,
		clean: {
			optype: '$0[pid,arg0]',
			table: '$0[pid,arg0]',
			latency: '$0[pid,arg0]',
			cputime: '$0[pid,arg0]'
		}
	    },

	    /* Batch operations */
	    {
		probes: [ 'moray*:::batch-op-start' ],
		gather: {
			optype: {
				gather: 'copyinstr(arg3)',
				store: 'global[pid,arg0]'
			},
			table: {
				gather: 'copyinstr(arg2)',
				store: 'global[pid,arg0]'
			},
			latency: {
				gather: 'timestamp',
				store: 'global[pid,arg0]'
			},
			cputime: {
				gather: 'vtimestamp',
				store: 'global[pid,arg0]'
			}
		}
	    },
	    {
		probes: [ 'moray*:::batch-op-done' ],
		aggregate: {
			optype: 'count()',
			table: 'count()',
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
			optype: '$0[pid,arg0]',
			table: '$0[pid,arg0]',
			latency: 'timestamp - $0[pid,arg0]',
			cputime: 'vtimestamp - $0[pid,arg0]',
			hostname:
			    '"' + mod_ca.caSysinfo().ca_hostname + '"',
			zonename: 'zonename',
			pid: 'lltostr(pid)',
			execname: 'execname',
			psargs: 'curpsinfo->pr_psargs'
		},
		verify: {
			optype: '$0[pid,arg0]',
			table: '$0[pid,arg0]',
			latency: '$0[pid,arg0]',
			cputime: '$0[pid,arg0]'
		}
	    },
	    {
	        probes: [ 'moray*:::batch-op-done' ],
		clean: {
			optype: '$0[pid,arg0]',
			table: '$0[pid,arg0]',
			latency: '$0[pid,arg0]',
			cputime: '$0[pid,arg0]'
		}
	    }
	],
	usepragmazone: true
    }
};

exports.cadMetricDesc = desc;
