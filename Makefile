#
# Makefile: top-level makefile
#

#
# Directories
#
BUILD		 = build
DIST		 = $(BUILD)/dist
PKGROOT		 = $(BUILD)/pkg
ROOT		 = $(BUILD)/root
ROOT_CA		 = $(ROOT)/opt/smartdc/ca
TOOLSDIR	 = tools
JS_SUBDIRS	 = cmd lib
SRC		:= $(shell pwd)
NODEDIR		:= $(SRC)/deps/node-install/bin

#
# Tools
#
BASH		 = bash
CSCOPE		 = cscope
JSL		 = $(TOOLSDIR)/jsl
JSSTYLE		 = $(TOOLSDIR)/jsstyle
XMLLINT		 = xmllint --noout
TAR		 = tar
RMTREE		 = rm -rf
NODE_WAF	:= $(NODEDIR)/node-waf
NPM		:= npm

#
# Files
#
JSL_CONF_MAIN		 = tools/jsl_support/jsl.conf
JSL_CONF_WEB		 = tools/jsl_support/jsl.web.conf
DEMO_JSFILES		 = demo/basicvis/cademo.js
DEMO_WEBJSFILES		 = demo/basicvis/caflot.js demo/basicvis/caadmin.js
JS_FILES 		:= $(shell find $(JS_SUBDIRS) -name '*.js')
DEMO_FILES		:= $(shell find demo -type f)
DEMO_DIRS		:= $(shell find demo -type d)
WEBJS_FILES 		 = $(DEMO_WEBJSFILES)
SMF_DTD 		 = /usr/share/lib/xml/dtd/service_bundle.dtd.1

SMF_MANIFESTS = \
	smf/manifest/smartdc-ca-caconfigsvc.xml 	\
	smf/manifest/smartdc-ca-caaggsvc.xml		\
	smf/manifest/smartdc-ca-cainstsvc.xml		\
	smf/manifest/cainstsvc.xml

SH_SCRIPTS = \
	pkg/pkg-postactivate.sh		\
	pkg/pkg-postdeactivate.sh	\
	smf/method/canodesvc		\
	tools/cadeploy			\
	tools/cadeploy-local

SVC_SCRIPTS = \
	pkg/pkg-svc-postactivate.sh	\
	pkg/pkg-svc-postdeactivate.sh

PKGS		 = cabase cainstsvc
PKG_TARBALLS	 = $(PKGS:%=$(PKGROOT)/%.tar.gz)

PKGDIRS_cabase := \
	$(PKGROOT)/cabase			\
	$(PKGROOT)/cabase/cmd			\
	$(PKGROOT)/cabase/cmd/cainst		\
	$(PKGROOT)/cabase/cmd/cainst/modules	\
	$(DEMO_DIRS:%=$(PKGROOT)/cabase/%)	\
	$(PKGROOT)/cabase/lib			\
	$(PKGROOT)/cabase/lib/ca		\
	$(PKGROOT)/cabase/pkg			\
	$(PKGROOT)/cabase/smf			\
	$(PKGROOT)/cabase/smf/manifest		\
	$(PKGROOT)/cabase/smf/method		\
	$(PKGROOT)/cabase/tools

PKGFILES_cabase = \
	$(PKGROOT)/cabase/package.json			\
	$(PKGROOT)/cabase/.npmignore			\
	$(PKGROOT)/cabase/cmd/node			\
	$(PKGROOT)/cabase/cmd/cactl.js			\
	$(DEMO_FILES:%=$(PKGROOT)/cabase/%)		\
	$(JS_FILES:%=$(PKGROOT)/cabase/%)		\
	$(SH_SCRIPTS:%=$(PKGROOT)/cabase/%)		\
	$(SMF_MANIFESTS:%=$(PKGROOT)/cabase/%)		\
	$(PKGROOT)/cabase/lib/ca

DEPS_cabase = \
	amqp		\
	connect		\
	heatmap		\
	kstat		\
	libdtrace	\
	png

PKGDEPS_cabase = $(DEPS_cabase:%=$(PKGROOT)/cabase/node_modules/%)

PKGDIRS_cainstsvc := \
	$(PKGROOT)/cainstsvc/pkg

PKGFILES_cainstsvc = \
	$(SVC_SCRIPTS:%=$(PKGROOT)/cainstsvc/%)		\
	$(PKGROOT)/cainstsvc/package.json

PKG_DIRS := \
	$(PKGROOT)		\
	$(PKGDIRS_cabase)	\
	$(PKGDIRS_cainstsvc)

ROOT_DIRS = \
	$(ROOT_CA)						\
	$(ROOT_CA)/cmd						\
	$(ROOT_CA)/cmd/cainst					\
	$(ROOT_CA)/cmd/cainst/modules				\
	$(ROOT_CA)/deps						\
	$(ROOT_CA)/deps/connect					\
	$(ROOT_CA)/deps/connect/connect				\
	$(ROOT_CA)/deps/connect/connect/middleware		\
	$(ROOT_CA)/deps/connect/connect/middleware/session	\
	$(ROOT_CA)/deps/node					\
	$(ROOT_CA)/deps/node-amqp				\
	$(ROOT_CA)/deps/node-heatmap				\
	$(ROOT_CA)/deps/node-libdtrace				\
	$(ROOT_CA)/deps/node-kstat				\
	$(ROOT_CA)/deps/node-png				\
	$(ROOT_CA)/lib						\
	$(ROOT_CA)/lib/ca					\
	$(ROOT_CA)/pkg						\
	$(ROOT_CA)/smf						\
	$(ROOT_CA)/smf/method					\
	$(ROOT_CA)/smf/manifest					\
	$(ROOT_CA)/tools					\

ROOT_FILES = \
	$(JS_FILES:%=$(ROOT_CA)/%)	\
	$(SH_SCRIPTS:%=$(ROOT_CA)/%)	\
	$(SMF_MANIFESTS:%=$(ROOT_CA)/%)

ROOT_DEPFILES := \
	$(ROOT_CA)/deps/node/node				\
	$(ROOT_CA)/deps/node-amqp/amqp.js			\
	$(ROOT_CA)/deps/node-amqp/amqp-definitions-0-8.js	\
	$(ROOT_CA)/deps/node-amqp/promise.js			\
	$(ROOT_CA)/deps/node-heatmap/heatmap.js			\
	$(ROOT_CA)/deps/node-kstat/kstat.node			\
	$(ROOT_CA)/deps/node-libdtrace/libdtrace.node		\
	$(ROOT_CA)/deps/node-png/png.node

CONNECT_FILES := $(shell cd deps/connect/lib && find connect -name '*.js')
ROOT_DEPFILES += $(CONNECT_FILES:%=$(ROOT_CA)/deps/connect/%)

NATIVE_DEPS = \
	deps/node/build/default/node				\
	deps/node-kstat/build/default/kstat.node		\
	deps/node-libdtrace/build/default/libdtrace.node	\
	deps/node-png/build/default/png.node

#
# Targets
#
all: $(SRC)/deps/node-install $(NATIVE_DEPS)

$(SRC)/deps/node-install:
	mkdir -p $(SRC)/deps/node-install

deps/node/build/default/node:
	(cd deps/node && ./configure --prefix=$(SRC)/deps/node-install && make install)

%.node: $(NODE_WAF)
	(cd deps/node-$(*F) && $(NODE_WAF) configure && $(NODE_WAF) build)

#
# "check" targets check syntax for files
#
check-manifests: $(SMF_MANIFESTS)
	$(XMLLINT) --dtdvalid $(SMF_DTD) $(SMF_MANIFESTS)

check-shell: $(SH_SCRIPTS)
	$(BASH) -n $(SH_SCRIPTS)

check-jsl: check-jsl-main check-jsl-web

check-jsl-main:
	$(JSL) --conf=$(JSL_CONF_MAIN) $(JS_FILES) $(DEMO_JSFILES)

check-jsl-web:
	$(JSL) --conf=$(JSL_CONF_WEB) $(WEBJS_FILES)

check-jsstyle:
	$(JSSTYLE) $(JS_FILES) $(DEMO_JSFILES) $(WEBJS_FILES)

check: check-shell check-manifests check-jsstyle check-jsl
	@echo check okay

#
# "xref" target builds the cscope cross-reference
#

cscope.files:
	find deps $(JS_SUBDIRS) $(DEMO_JSFILES) $(DEMO_WEBJSFILES) \
	    -type f -name '*.js' -o -name '*.c' -o \
	    -name '*.cpp' -o -name '*.cc' -o -name '*.h' > cscope.files

xref: cscope.files
	$(CSCOPE) -bqR

.PHONY: cscope.files

#
# "pkg" target builds package tarball
#
pkg: $(PKG_TARBALLS)

$(PKGROOT)/cabase.tar.gz: install-cabase
	cd $(PKGROOT) && $(TAR) cf - cabase | gzip > cabase.tar.gz

$(PKGROOT)/cainstsvc.tar.gz: install-cainstsvc
	cd $(PKGROOT) && $(TAR) cf - cainstsvc | gzip > cainstsvc.tar.gz

#
# "install" target install files into the proto ("root") area
#
install: all install-rootdirs install-rootfiles install-deps \
    install-pkgs

install-rootdirs: $(ROOT_DIRS)

install-pkgdirs: $(PKG_DIRS)

install-pkgs: install-cabase

install-cabase: all install-pkgdirs $(PKGFILES_cabase) $(PKGDEPS_cabase)

install-cainstsvc: install-cabase $(PKGFILES_cainstsvc) $(PKGDEPS_cainstsvc)

$(PKGROOT)/cabase/node_modules/%: deps/%
	cd $(PKGROOT)/cabase && PATH=$$PATH:$(NODEDIR) $(NPM) bundle install $(SRC)/$^

$(PKGROOT)/cabase/node_modules/%: deps/node-%
	cd $(PKGROOT)/cabase && PATH=$$PATH:$(NODEDIR) $(NPM) bundle install $(SRC)/$^

$(PKG_DIRS):
	mkdir -p $(PKG_DIRS)

$(PKGROOT)/cabase/cmd/node: deps/node/node
	cp $^ $@

$(PKGROOT)/cabase/%: %
	cp $^ $@

$(PKGROOT)/cainstsvc/%: %
	cp $^ $@

$(PKGROOT)/%/package.json: pkg/%-package.json
	cp $^ $@

$(PKGROOT)/%/.npmignore: pkg/npm-ignore
	grep -v ^# $^ > $@

$(ROOT_DIRS):
	mkdir -p $(ROOT_DIRS)

install-rootfiles: $(ROOT_FILES)

$(ROOT_CA)/%: %
	cp $^ $@

install-deps: $(ROOT_DEPFILES)

$(ROOT_CA)/deps/%.js: deps/%.js
	cp $^ $@

$(ROOT_CA)/deps/%.js: deps/connect/lib/%.js
	cp $^ $@

$(ROOT_CA)/deps/connect/%.js: deps/connect/lib/%.js
	cp $^ $@

$(ROOT_CA)/deps/node-heatmap/heatmap.js: deps/node-heatmap/lib/heatmap.js
	cp $^ $@

$(ROOT_CA)/deps/node-png/png.node: deps/node-png/build/default/png.node
	cp $^ $@

$(ROOT_CA)/deps/node-kstat/kstat.node: deps/node-kstat/build/default/kstat.node
	cp $^ $@

$(ROOT_CA)/deps/node-libdtrace/libdtrace.node: deps/node-libdtrace/build/default/libdtrace.node
	cp $^ $@

$(ROOT_CA)/deps/node/node: deps/node-install/bin/node
	cp $^ $@

#
# "dist" target creates tarball from the current root
#
dist: $(DIST) $(DIST)/dist.tar.gz

$(DIST):
	mkdir -p $@

$(DIST)/dist.tar.gz: install
	(cd $(ROOT) && $(TAR) cf - *) | gzip > $(DIST)/dist.tar.gz

#
# The "release" target creates a ca.tar.bz2 suitable for release to the
# head-node. To formally release this, it should be copied to assets.joyent.us
# and placed into the /data/assets/templates/liveimg directory.  (Access
# assets.joyent.us via the user "jill", for which access is exclusively via
# authorized ssh key.)  That is, to formally release it, from build/dist:
#
#     scp ca.tar.bz2 jill@assets.joyent.us:/data/assets/templates/liveimg
#
# Subsequent head-node builds will then pick up the new release.
#
release: $(DIST) $(DIST)/ca.tar.bz2

$(DIST)/ca.tar.bz2: install
	(cd $(BUILD) && $(TAR) cf - root) | bzip2 > $(DIST)/ca.tar.bz2

#
# "clean" target removes created files -- we currently have none
#
clean:

#
# "dist-clean" target removes installed root and built dependencies
#
dist-clean:
	(cd deps/node-kstat && $(NODE_WAF) distclean)
	(cd deps/node-libdtrace && $(NODE_WAF) distclean)
	(cd deps/node-png && $(NODE_WAF) distclean)
	(cd deps/node && $(MAKE) distclean)
	$(RMTREE) $(BUILD) deps/node-install
