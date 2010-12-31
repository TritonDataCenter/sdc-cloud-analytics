#!/usr/bin/bash

function fatal
{
	echo "${npm_package_name} postdeactivate: fatal error: $*"
	exit 1
}

svc=${npm_package_name}
manifest=${npm_config_smfdir}/${svc}.xml
fmri=`svccfg inventory ${manifest} | grep ':default'`

svcadm disable -s $fmri || fatal "could not disable $fmri"
svccfg delete $fmri || fatal "could not delete $fmri"
rm $manifest || fatal "could not delete $manifest"

exit 0
