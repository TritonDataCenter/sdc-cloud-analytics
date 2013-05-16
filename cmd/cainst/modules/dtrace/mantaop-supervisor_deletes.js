/*
 * DTrace metric for Manta delete operations
 */
var mod_ca = require('../../../../lib/ca/ca-common');

var desc = {
    module: 'mantaop',
    stat: 'supervisor_deletes',
    fields: [ 'hostname', 'zonename', 'objname', 'latency', 'errname' ],
    metad: {
	probedesc: [ {
	    probes: [ 'marlin-supervisor*:::delete-start' ],
	    gather: {
		latency: {
			gather: 'timestamp',
			store: 'global[pid,copyinstr(arg0)]'
		}
	    }
	}, {
	    probes: [ 'marlin-supervisor*:::delete-done' ],
	    verify: {
		latency: '$0[pid,copyinstr(arg0)]'
	    },
	    transforms: {
		hostname: '"' + mod_ca.caSysinfo().ca_hostname + '"',
		zonename: 'zonename',
		objname: 'copyinstr(arg0)',
		errname: 'copyinstr(arg1)',
		latency: 'timestamp - $0[pid,copyinstr(arg0)]'
	    },
	    aggregate: {
		default: 'count()',
		hostname: 'count()',
		zonename: 'count()',
		objname: 'count()',
		errname: 'count()',
		latency: 'llquantize($0, 10, 3, 11, 100)'
	    }
	}, {
	    probes: [ 'marlin-supervisor*:::delete-done' ],
	    clean: {
		latency: '$0[pid,copyinstr(arg0)]'
	    }
	} ],
	usepragmazone: true
    }
};

exports.cadMetricDesc = desc;
