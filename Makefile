#
# Makefile: top-level makefile.
#
# This Makefile uses many conventions documented in the eng.git Makefile
# system.  We also make heavy use of the Makefiles in that repo.
#

#
# The following definitions and rules bootstrap us to where we can include
# Makefiles from the eng.git submodule.
#
.DEFAULT_GOAL	:= all
INCMAKE		 = deps/eng/tools/mk

$(INCMAKE)/%:
	git submodule update --init deps/eng

#
# Directories and files used during the build.
#
DEMO_DIRS	:= $(shell find demo -type d)
DEMO_FILES	:= $(shell find demo -type f)
DEMO_JSFILES	:= demo/basicvis/cademo.js
DEMO_WEBJSFILES	:= \
	demo/basicvis/caflot.js		\
	demo/basicvis/caadmin.js	\
	demo/basicvis/camon.js

JS_SUBDIRS	 = cmd lib tools tst
JS_FILES 	:= $(shell find $(JS_SUBDIRS) -name '*.js')

JSON_FILES	:= $(shell find pkg -name '*.json')

METAD_DIR	 = cmd/cainst/modules/dtrace
METAD_FILES	:= $(shell find $(METAD_DIR) -name '*.js')

METADATA_FILES	:= $(shell find metadata -name '*.json')

SH_SCRIPTS	= \
	cmd/cazoneinstall		\
	pkg/pkg-svc-postinstall.sh	\
	pkg/pkg-svc-postuninstall.sh	\
	smf/method/canodesvc		\
	tools/cabranch			\
	tools/cainstrfleet		\
	tools/catest			\
	tools/caupagent			\
	tools/devsetup			\
	tools/devsetup.manta

SVC_SCRIPTS	 = \
	pkg/pkg-svc-postinstall.sh	\
	pkg/pkg-svc-postuninstall.sh

TOOLSDIR	 = tools

TST_DIRS	 := $(shell find tst -type d)

#
# Release artifacts
#
BUILD		 = build
DIST		 = $(BUILD)/dist
RELEASE_TARBALL  = $(DIST)/ca-pkg-$(STAMP).tar.bz2

#
# Package definitions: since cloud-analytics delivers multiple packages, we
# dynamically construct each one at build time by copying the appropriate
# files into $(PKGROOT)/<pkgname>.  The following variable definitions define
# what should go where, and several targets below use these to implement that.
#
PKGROOT		 = $(BUILD)/pkg
PKG_NAMES	 = cabase cainstsvc
PKG_TARBALLS	 = $(PKG_NAMES:%=$(PKGROOT)/%.tar.gz)

PKG_DIRS = \
	$(PKGROOT)		\
	$(PKGDIRS_cabase)	\
	$(PKGDIRS_cainstsvc)	\

# cainstsvc package
PKGDIRS_cainstsvc := \
	$(PKGROOT)/cainstsvc/pkg

PKGFILES_cainstsvc = \
	$(SVC_SCRIPTS:%=$(PKGROOT)/cainstsvc/%)		\
	$(PKGROOT)/cainstsvc/package.json

# cabase package
PKGDIRS_cabase = \
	$(PKGROOT)/cabase				\
	$(PKGROOT)/cabase/cmd				\
	$(PKGROOT)/cabase/cmd/caagg			\
	$(PKGROOT)/cabase/cmd/caagg/transforms		\
	$(PKGROOT)/cabase/cmd/cainst			\
	$(PKGROOT)/cabase/cmd/cainst/modules		\
	$(PKGROOT)/cabase/cmd/cainst/modules/dtrace	\
	$(DEMO_DIRS:%=$(PKGROOT)/cabase/%)		\
	$(PKGROOT)/cabase/docs				\
	$(PKGROOT)/cabase/lib				\
	$(PKGROOT)/cabase/lib/ca			\
	$(PKGROOT)/cabase/lib/tst			\
	$(PKGROOT)/cabase/metadata			\
	$(PKGROOT)/cabase/metadata/metric		\
	$(PKGROOT)/cabase/metadata/profile		\
	$(PKGROOT)/cabase/pkg				\
	$(PKGROOT)/cabase/sapi_manifests		\
	$(PKGROOT)/cabase/sapi_manifests/ca		\
	$(PKGROOT)/cabase/sapi_manifests/registrar	\
	$(PKGROOT)/cabase/smf				\
	$(PKGROOT)/cabase/smf/manifest			\
	$(PKGROOT)/cabase/smf/method			\
	$(PKGROOT)/cabase/tools				\
	$(PKGROOT)/cabase/tools/dev			\
	$(TST_DIRS:%=$(PKGROOT)/cabase/%)

PKGFILES_cabase = \
	$(PKGROOT)/cabase/package.json			\
	$(PKGROOT)/cabase/.npmignore			\
	$(PKGROOT)/cabase/cmd/node			\
	$(PKGROOT)/cabase/cmd/cactl.js			\
	$(PKGROOT)/cabase/cmd/ctf2json			\
	$(DEMO_FILES:%=$(PKGROOT)/cabase/%)		\
	$(DOC_FILES:%.restdown=$(PKGROOT)/cabase/docs/%.html)	\
	$(JS_FILES:%=$(PKGROOT)/cabase/%)		\
	$(BASH_FILES:%=$(PKGROOT)/cabase/%)		\
	$(SMF_MANIFESTS:%=$(PKGROOT)/cabase/%)		\
	$(METADATA_FILES:%=$(PKGROOT)/cabase/%)		\
	$(PKGROOT)/cabase/lib/httpd.d			\
	$(PKGROOT)/cabase/lib/node.d			\
	$(PKGROOT)/cabase/sapi_manifests/ca/manifest.json	\
	$(PKGROOT)/cabase/sapi_manifests/ca/template		\
	$(PKGROOT)/cabase/sapi_manifests/registrar/manifest.json	\
	$(PKGROOT)/cabase/sapi_manifests/registrar/template		\
	$(PKGROOT)/cabase/tools/nhttpsnoop

DEPS_cabase = \
	amqp		\
	ca-native	\
	connect		\
	ctype		\
	heatmap		\
	kstat		\
	libdtrace	\
	png		\
	uname		\
	libGeoIP

PKGDEPS_cabase = $(DEPS_cabase:%=$(PKGROOT)/cabase/node_modules/%)

#
# Build configuration: these variables are used by various targets provided the
# included Makefiles.
#
BASH_FILES	 = $(SH_SCRIPTS) $(SVC_SCRIPTS)

CLEAN_FILES	+= $(BUILD)

CSCOPE_DIRS	 = cmd demo lib tst deps

DOC_FILES	 = \
	dev.restdown			\
	index.restdown			\

JSL_FILES_NODE	 = $(JS_FILES) $(DEMO_JSFILES)
JSL_FILES_WEB    = $(DEMO_WEBJSFILES)
JSL_CONF_WEB	 = tools/jsl.web.conf
JSL_CONF_NODE	 = tools/jsl.node.conf
JSSTYLE_FILES	 = $(JSL_FILES_NODE) $(JSL_FILES_WEB)

SMF_DTD		 = deps/eng/tools/service_bundle.dtd.1
SMF_MANIFESTS	 = \
	smf/manifest/caconfigsvc.xml	\
	smf/manifest/caaggsvc.xml	\
	smf/manifest/cainstsvc.xml	\
	smf/manifest/castashsvc.xml

#
# Tools used by the build process
#

#
# NODE_ENV defines the NODE_PATH environment variable for use when we invoke
# tools.  We need this because the tools use modules that don't get set up by
# npm (see INTRO-632).  This definition should really use ":=" to avoid
# invoking the shell every time it's used, but tools/npath computes the desired
# environment based on what's already been built, which may be nothing until
# later in the build.
#
NODE_ENV	 = $(shell tools/npath)

BASHSTYLE	 = deps/eng/tools/bashstyle
CAMCHK		 = $(NODE_ENV) $(NODE) $(TOOLSDIR)/camchk.js > /dev/null
CAMD		 = $(NODE_ENV) $(NODE) $(TOOLSDIR)/camd.js
CAPROF		 = $(NODE_ENV) $(NODE) $(TOOLSDIR)/caprof.js
JSONCHK		 = $(NODE_ENV) $(NODE) $(TOOLSDIR)/jsonchk.js
RESTDOWN	 = python2.6 $(TOP)/deps/restdown/bin/restdown
TAR		 = tar

include $(INCMAKE)/Makefile.defs
include $(INCMAKE)/Makefile.smf.defs
include $(INCMAKE)/Makefile.node.defs

#
# Targets.  See the Joyent Engineering Guidelines or the included Makefiles for
# descriptions of what these targets are supposed to do.  Note that many of
# these targets (notably check, clean, and distclean) are augmented by the
# included Makefiles.
#
all: release

test: pkg
	tools/catest -a -t build/test_results.tap

# For historical reasons, we alias "pbchk" to "prepush"
pbchk: prepush

clean::
	-(cd deps/ctf2json && $(MAKE) clean)

distclean:: clean
	-(cd deps/javascriptlint && $(MAKE) clean)
	-(cd deps/node && $(MAKE) distclean)

#
# "release" target implementation
#
release: $(RELEASE_TARBALL) sdc-scripts

$(RELEASE_TARBALL): $(PKG_TARBALLS) | $(DIST)
	mkdir -p $(BUILD)/root/opt/smartdc/sdc-boot/scripts
	cp $(TOP)/sdc-boot/*.sh $(BUILD)/root/opt/smartdc/sdc-boot/
	cp $(TOP)/deps/sdc-scripts/*.sh $(BUILD)/root/opt/smartdc/sdc-boot/scripts/
	[[ -e $(BUILD)/root/pkg ]] || ln -s $(TOP)/$(BUILD)/pkg $(BUILD)/root/pkg
	[[ -e $(BUILD)/root/opt/smartdc/ca ]] || \
	    ln -s $(TOP)/$(BUILD)/pkg/cabase $(BUILD)/root/opt/smartdc/ca
	(cd $(BUILD) && $(TAR) chf - root/pkg/*.gz root/opt) | bzip2 > $@

$(DIST):
	mkdir -p $@

#
# "check" target implementation.
#
check: check-metadata check-metad check-json

check-metadata: $(METADATA_FILES:%=%.check)

check-metad: | $(PKG_TARBALLS)
	$(CAMD) $(METAD_FILES)

metadata/profile/%.json.check: metadata/profile/%.json | $(PKG_TARBALLS)
	$(CAPROF) $<

metadata/metric/%.json.check: metadata/metric/%.json | $(PKG_TARBALLS)
	$(CAMCHK) $<

check-json: $(JSON_FILES:%=%.check)

%.json.check: %.json $(PKG_TARBALLS)
	$(JSONCHK) $<

#
# The "publish" target copies the build bits to the given BITS_DIR.  This is
# invoked by an external driver (e.g. CI).
#
publish: $(RELEASE_TARBALL)
	@if [[ -z "$(BITS_DIR)" ]]; then \
		echo "error: 'BITS_DIR' must be set for 'publish' target"; \
		exit 1; \
	fi
	mkdir -p $(BITS_DIR)/ca
	cp $(RELEASE_TARBALL) $(BITS_DIR)/ca/ca-pkg-$(STAMP).tar.bz2
	cp $(PKGROOT)/cabase.tar.gz $(BITS_DIR)/ca/cabase-$(STAMP).tar.gz
	cp $(PKGROOT)/cainstsvc.tar.gz $(BITS_DIR)/ca/cainstsvc-$(STAMP).tar.gz

#
# The "pkg" target builds tarballs for each of the npm packages based on the
# PKG variables defined above.  These targets describe how to construct the
# file tree that goes in each package.
#
pkg: $(PKG_TARBALLS)

$(PKGROOT)/%.tar.gz:
	(cd $(PKGROOT) && $(TAR) cf - $*) | gzip > $@

$(PKGROOT)/cabase.tar.gz:	$(PKGFILES_cabase) | $(PKGDEPS_cabase)
$(PKGROOT)/cainstsvc.tar.gz:	$(PKGFILES_cainstsvc)

$(PKGFILES_cabase) $(PKGFILES_cainstsvc): | $(PKG_DIRS)

$(PKG_DIRS):
	mkdir -p $(PKG_DIRS)

$(PKGROOT)/cabase/node_modules/ca-native: | $(NPM_EXEC)
	cd $(PKGROOT)/cabase && $(NPM) install $(TOP)/deps/ca-native
	(echo '!./build'; echo '!./node_modules') >> \
	    $(PKGROOT)/cabase/node_modules/ca-native/.npmignore

$(PKGROOT)/cabase/node_modules/connect: | $(NPM_EXEC) deps/connect/.git
	cd $(PKGROOT)/cabase && $(NPM) install $(TOP)/deps/connect
	(echo '!./build'; echo '!./node_modules') >> \
	    $(PKGROOT)/cabase/node_modules/connect/.npmignore

$(PKGROOT)/cabase/node_modules/%: | $(NPM_EXEC) deps/node-%/.git
	cd $(PKGROOT)/cabase && $(NPM) install $(TOP)/deps/node-$*
	(echo '!./build'; echo '!./node_modules') >> \
	    $(PKGROOT)/cabase/node_modules/$*/.npmignore

$(PKGROOT)/cabase/cmd/node: $(NODE_EXEC)
	cp $^ $@

$(PKGROOT)/cabase/cmd/ctf2json: deps/ctf2json/ctf2json
	cp $^ $@

deps/ctf2json/ctf2json: | deps/ctf2json/.git
	cd deps/ctf2json && $(MAKE)

$(PKGROOT)/%/package.json: pkg/%-package.json FORCE
	sed -e 's#@@CA_VERSION@@#$(STAMP)#g' $< > $@

$(PKGROOT)/%/.npmignore: pkg/npm-ignore
	grep -v ^# $^ > $@

$(PKGROOT)/cabase/%: %
	cp $^ $@

$(PKGROOT)/cainstsvc/%: %
	cp $^ $@

#
# "FORCE" target is used as a dependency to require a given target to run every
# time.  This should rarely be necessary.
#
FORCE:
.PHONY: FORCE

#
# XXX This can be removed once CA upgrades beyond node 0.6 along with patches/
#
# In node 0.6, to build v8, node requires the use of scons. scons makes various
# assumptions about what happens if you're on SunOS. Particularly, it tries to
# ensure that /opt/SUNWspro/bin is rather far up on your path. Generally this
# shouldn't be a problem because when we build, we don't have studio
# installed; however, this is not actually the case. Sun Studio is still used as
# a part of building parts of the platform that are not illumos itself. On
# jenkins build slaves which can also build the platform, it turns out that we
# can end up where scons finds studio. There are multiple problems with this.
# The most significant is that studio assumes and requires ar to be in
# /usr/ccs/bin. This obviously will not work for us. Fixing this correctly is
# challenging as node doesn't have an easy way to pass flags to scons. The most
# expedient solution is just to remove the portion of the scons source embedded
# in node that does this.
#
deps/node/.git:
	git submodule update --init deps/node
	patch -d deps/node -p1 < patches/node-scons.patch

include $(INCMAKE)/Makefile.deps
include $(INCMAKE)/Makefile.targ
include $(INCMAKE)/Makefile.smf.targ
include $(INCMAKE)/Makefile.node.targ

sdc-scripts: deps/sdc-scripts/.git
.PHONY: sdc-scripts
