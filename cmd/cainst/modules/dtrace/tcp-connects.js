/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * DTrace metric for TCP connects, using the syscall provider.
 */
var mod_ca = require('../../../../lib/ca/ca-common');

var desc = {
    module: 'tcp',
    stat: 'connects',
    fields: [ 'hostname', 'zonename', 'pid', 'execname', 'psargs', 'ppid',
	'pexecname', 'ppsargs', 'rport', 'raddr' ],
    fields_internal: [ 'sockaddr' ],
    metad: {
	locals: [
	    { addrtype: 'uint16_t' }
	],
	probedesc: [
	    {
		probes: [ 'syscall::connect:entry' ],
		alwaysgather: {
			sockaddr: {
				gather: 'arg1',
				store: 'thread'
			}
		}
	    },
	    {
		probes: [ 'syscall::connect:return' ],
		local: [ {
		    addrtype: '*(uint16_t *)copyin(self->sockaddr0, \n' +
			'sizeof (uint16_t))'
		} ],
		predicate: 'arg1 == 0 && (this->addrtype == AF_INET || ' +
		    'this->addrtype == AF_INET6)',
		aggregate: {
			default: 'count()',
			hostname: 'count()',
			zonename: 'count()',
			pid: 'count()',
			execname: 'count()',
			psargs: 'count()',
			ppid: 'count()',
			pexecname: 'count()',
			ppsargs: 'count()',
			rport: 'count()',
			raddr: 'count()'
		},
		transforms: {
			hostname:
			    '"' + mod_ca.caSysinfo().ca_hostname + '"',
			zonename: 'zonename',
			pid: 'lltostr(pid)',
			execname: 'execname',
			psargs: 'curpsinfo->pr_psargs',
			ppid: 'lltostr(ppid)',
			pexecname: 'curthread->t_procp->p_parent->' +
			    'p_user.u_comm',
			ppsargs:
			    'curthread->t_procp->p_parent->p_user.u_psargs',
			rport: [
			    'ntohs((this->addrtype == AF_INET) ? ',
			    '((struct sockaddr_in *)copyin(self->sockaddr0, ',
			    '    sizeof (struct sockaddr_in *)))->sin_port : ',
			    '((struct sockaddr_in6 *)copyin(self->sockaddr0, ',
			    '    sizeof (struct sockaddr_in6 *)))->sin6_port)'
			].join('\n'),
			raddr: [
			    '(this->addrtype == AF_INET) ? ',
			    'inet_ntoa((ipaddr_t *)',
			    '    &(((struct sockaddr_in *)copyin(',
			    '        self->sockaddr0, ',
			    '    sizeof (struct sockaddr_in *)))->sin_addr)) :',
			    ' inet_ntoa6((in6_addr_t *)',
			    '    &(((struct sockaddr_in6 *)copyin(',
			    'self->sockaddr0, ',
			    '    sizeof (struct sockaddr_in6 *)))->sin6_addr))'
			].join('\n')
		},
		verify: {
			sockaddr: '$0'
		}
	    },
	    {
		probes: [ 'syscall::connect:return' ],
		clean: {
			sockaddr: '$0'
		}
	    }
	]
    }
};

exports.cadMetricDesc = desc;
