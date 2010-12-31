#!/usr/bin/bash

function fatal
{
	echo "${npm_package_name} postactivate: fatal error: $*"
	exit 1
}

#
# This is a little grotty, but we're going to reach into cabase and pull the
# manifest to the SMF directory.
#
svc=${npm_package_name}
manifest=${svc}.xml
pkg=${npm_config_root}/.npm/cabase/active/package

cp ${pkg}/smf/manifest/${manifest} $npm_config_smfdir || \
     fatal "could not copy $pkg/smf/manifest/$manifest to $npm_config_smfdir"

manifest=${npm_config_smfdir}/${manifest}

fmri=`svccfg inventory ${manifest} | grep ':default'`

svccfg import ${manifest} || fatal "could not import ${manifest}"
svcadm enable -s $fmri || fatal "could not enable $fmri"

exit 0
