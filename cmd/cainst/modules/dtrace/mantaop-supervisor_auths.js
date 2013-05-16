/*
 * DTrace metric for Manta auth operations
 */
var mod_ca = require('../../../../lib/ca/ca-common');

var desc = {
    module: 'mantaop',
    stat: 'supervisor_auths',
    fields: [ 'hostname', 'zonename', 'user', 'latency', 'errname' ],
    metad: {
	probedesc: [ {
	    probes: [ 'marlin-supervisor*:::auth-start' ],
	    gather: {
		latency: {
			gather: 'timestamp',
			store: 'global[pid,copyinstr(arg0)]'
		}
	    }
	}, {
	    probes: [ 'marlin-supervisor*:::auth-done' ],
	    verify: {
		latency: '$0[pid,copyinstr(arg0)]'
	    },
	    transforms: {
		hostname: '"' + mod_ca.caSysinfo().ca_hostname + '"',
		zonename: 'zonename',
		user: 'copyinstr(arg0)',
		errname: 'copyinstr(arg1)',
		latency: 'timestamp - $0[pid,copyinstr(arg0)]'
	    },
	    aggregate: {
		default: 'count()',
		hostname: 'count()',
		zonename: 'count()',
		user: 'count()',
		errname: 'count()',
		latency: 'llquantize($0, 10, 3, 11, 100)'
	    }
	}, {
	    probes: [ 'marlin-supervisor*:::auth-done' ],
	    clean: {
		latency: '$0[pid,copyinstr(arg0)]'
	    }
	} ],
	usepragmazone: true
    }
};

exports.cadMetricDesc = desc;
