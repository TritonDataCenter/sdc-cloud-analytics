#!/bin/bash

set -e
set -o xtrace

DIRNAME=$(cd `dirname $0`; pwd)
git submodule update --init
gmake pkg

NAME=cloud_analytics
BRANCH=$(git symbolic-ref HEAD | cut -d'/' -f3)
DESCRIBE=$(git describe)
BUILDSTAMP=`TZ=UTC date "+%Y%m%dT%H%M%SZ"`; export BUILDSTAMP
PKG_SUFFIX=${BRANCH}-${BUILDSTAMP}-${DESCRIBE}.tgz
CABASE_PKG=cabase-${PKG_SUFFIX}
CAINSTSVC_PKG=cainstsvc-${PKG_SUFFIX}
PUBLISH_LOCATION=/rpool/data/coal/live_147/agents/${NAME}/${BRANCH}/

source $DIRNAME/publish.sh
