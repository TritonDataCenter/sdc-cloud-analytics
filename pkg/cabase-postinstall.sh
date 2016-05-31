#!/bin/bash
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright (c) 2016, Joyent, Inc.
#

set -o xtrace

export ETC_DIR=$npm_config_etc
export AGENT=$npm_package_name

source /lib/sdc/config.sh
load_sdc_config

# ---- support functions

function fatal()
{
    echo "error: $*" >&2
    exit 1
}

function warn_and_exit()
{
    echo "warning: $*" >&2
    exit 0
}

function instance_exists()
{
    local instance_uuid=$1
    local sapi_instance=$(curl ${SAPI_URL}/instances/${instance_uuid} | json -H uuid)

    if [[ -n ${sapi_instance} ]]; then
        return 0
    else
        return 1
    fi
}

function adopt_instance_if_necessary()
{
    local instance_uuid=$(cat $ETC_DIR/$AGENT)

    # verify it exists on sapi if there is an instance uuid written to disk
    if [[ -n ${instance_uuid} ]]; then
        if ! instance_exists "$instance_uuid"; then
            adopt_instance $instance_uuid
        fi
    else
        adopt_instance $(uuid -v4)
    fi
}

# This is a best effort. We rely into a cn-agent dedicated task to register
# new agent instances when needed.
function adopt_instance()
{
    local instance_uuid=$1
    echo $instance_uuid > $ETC_DIR/$AGENT

    local service_uuid=""
    local sapi_instance=""
    local i=0

    service_uuid=$(curl "${SAPI_URL}/services?type=agent&name=${AGENT}"\
        -sS -H accept:application/json | json -Ha uuid)

    [[ -n ${service_uuid} ]] || \
        warn_and_exit "Unable to get service_uuid for role ${AGENT} from SAPI"

    sapi_instance=$(curl ${SAPI_URL}/instances -sS -X POST \
        -H content-type:application/json \
        -d "{ \"service_uuid\" : \"${service_uuid}\", \"uuid\" : \"${instance_uuid}\" }" \
    | json -H uuid)

    [[ -n ${sapi_instance} ]] \
        || warn_and_exit "Unable to adopt ${instance_uuid} into SAPI"
    echo "Adopted service ${AGENT} to instance ${instance_uuid}"
}

function save_instance_uuid()
{
    local instance_uuid=$(cat $ETC_DIR/$AGENT)

    if [[ -z ${instance_uuid} ]]; then
        instance_uuid=$(uuid -v4)
        echo $instance_uuid > $ETC_DIR/$AGENT
    fi
}

# ---- mainline

# If agentsshar is being installed on an old SAPI/CN, we can leave this instance
# disabled and avoid running any SAPI-dependant configuration. sapi_domain is
# zero length when the upgrade scripts we need were not executed for this CN
if [[ -z $CONFIG_sapi_domain ]]; then
    echo "sapi_domain was not found on node.config, agent will be installed but not configured"
    exit 0
fi

SAPI_URL=http://${CONFIG_sapi_domain}
IMGAPI_URL=http://${CONFIG_imgapi_domain}

# Check if we're inside a headnode and if there is a SAPI available. This post-
# install script runs in the following circumstances:
# 1. (don't call adopt) hn=1, sapi=0: first hn boot, disable agent, exit 0
# 2. (call adopt) hn=1, sapi=1: upgrades, run script, get-or-create instance
# 3. (call adopt) hn=0, sapi=0: new cns, cn upgrades, run script, get-or-create instance
# 4. (call adopt) hn=0, sapi=1: no sdc-sapi on CNs, unexpected but possible
is_headnode=$(sysinfo | json "Boot Parameters".headnode)
have_sapi=false

(/opt/smartdc/bin/sdc-sapi /ping)
if [[ $? == 0 ]]; then
    have_sapi="true"
fi

# case 1) is first time this agent is installed on the headnode. We just need
# to save the instance uuid since headnode.sh takes care of adopting it into
# SAPI
if [[ $is_headnode == "true" ]] && [[ $have_sapi == "false" ]]; then
    save_instance_uuid
    exit 0
fi

# Before adopting instances into SAPI we need to check if SAPI is new enough so
# it will understand a request for adding an agent instance to it

MIN_VALID_SAPI_VERSION=20140703

# SAPI versions can have the following two forms:
#
#   release-20140724-20140724T171248Z-gf4a5bed
#   master-20140724T174534Z-gccfea7e
#
# We need at least a MIN_VALID_SAPI_VERSION image so type=agent suport is there.
# When the SAPI version doesn't match the expected format we ignore this script
#
valid_sapi=$(curl ${IMGAPI_URL}/images/$(curl ${SAPI_URL}/services?name=sapi | json -Ha params.image_uuid) \
    | json -e \
    "var splitVersion = this.version.split('-');
    if (splitVersion[0] === 'master') {
        this.validSapi = splitVersion[1].substr(0, 8) >= '$MIN_VALID_SAPI_VERSION';
    } else if (splitVersion[0] === 'release') {
        this.validSapi = splitVersion[1] >= '$MIN_VALID_SAPI_VERSION';
    } else {
        this.validSapi = false;
    }
    " | json validSapi)

if [[ ${valid_sapi} == "false" ]]; then
    echo "Datacenter does not have the minimum SAPI version needed for adding
        service agents. No need to adopt agent into SAPI"
    exit 0
else
    adopt_instance_if_necessary
fi

exit 0
