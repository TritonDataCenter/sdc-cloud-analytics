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
TST_SUBDIRS	 = tst
SRC		:= $(shell pwd)
NODEDIR		:= $(SRC)/deps/node-install/bin
WEBREV		 = $(TOOLSDIR)/webrev_support

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
MKERRNO		 = $(TOOLSDIR)/mkerrno
CC		 = gcc

#
# Files
#
JSL_CONF_MAIN		 = $(TOOLSDIR)/jsl_support/jsl.conf
JSL_CONF_WEB		 = $(TOOLSDIR)/jsl_support/jsl.web.conf
DEMO_JSFILES		 = demo/basicvis/cademo.js
DEMO_WEBJSFILES		 = demo/basicvis/caflot.js demo/basicvis/caadmin.js
JS_FILES 		:= $(shell find $(JS_SUBDIRS) -name '*.js')
JS_FILES		+= lib/ca/errno.js
DEMO_FILES		:= $(shell find demo -type f)
DEMO_DIRS		:= $(shell find demo -type d)
WEBJS_FILES 		 = $(DEMO_WEBJSFILES)
TST_JSFILES		:= $(shell find $(TST_SUBDIRS) -name '*.js')
SMF_DTD 		 = /usr/share/lib/xml/dtd/service_bundle.dtd.1

SMF_MANIFESTS = \
	smf/manifest/caconfigsvc.xml			\
	smf/manifest/caaggsvc.xml			\
	smf/manifest/cainstsvc.xml

SH_SCRIPTS = \
	pkg/pkg-postactivate.sh		\
	pkg/pkg-postdeactivate.sh	\
	smf/method/canodesvc		\
	tools/cadeploy			\
	tools/ca-headnode-setup

SVC_SCRIPTS = \
	pkg/pkg-svc-postactivate.sh	\
	pkg/pkg-svc-postdeactivate.sh

PKGS		 = cabase caconfigsvc caaggsvc cainstsvc
PKG_TARBALLS	 = $(PKGS:%=$(PKGROOT)/%.tar.gz)

PKGDIRS_cabase := \
	$(PKGROOT)/cabase			\
	$(PKGROOT)/cabase/cmd			\
	$(PKGROOT)/cabase/cmd/caagg		\
	$(PKGROOT)/cabase/cmd/caagg/transforms	\
	$(PKGROOT)/cabase/cmd/cainst		\
	$(PKGROOT)/cabase/cmd/cainst/modules	\
	$(DEMO_DIRS:%=$(PKGROOT)/cabase/%)	\
	$(PKGROOT)/cabase/lib			\
	$(PKGROOT)/cabase/lib/ca		\
	$(PKGROOT)/cabase/lib/tst		\
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
	png		\
	uname		\
	libGeoIP

PKGDEPS_cabase = $(DEPS_cabase:%=$(PKGROOT)/cabase/node_modules/%)

PKGDIRS_caconfigsvc := \
	$(PKGROOT)/caconfigsvc/pkg

PKGFILES_caconfigsvc = \
	$(SVC_SCRIPTS:%=$(PKGROOT)/caconfigsvc/%)		\
	$(PKGROOT)/caconfigsvc/package.json

PKGDIRS_caaggsvc := \
	$(PKGROOT)/caaggsvc/pkg

PKGFILES_caaggsvc = \
	$(SVC_SCRIPTS:%=$(PKGROOT)/caaggsvc/%)		\
	$(PKGROOT)/caaggsvc/package.json

PKGDIRS_cainstsvc := \
	$(PKGROOT)/cainstsvc/pkg

PKGFILES_cainstsvc = \
	$(SVC_SCRIPTS:%=$(PKGROOT)/cainstsvc/%)		\
	$(PKGROOT)/cainstsvc/package.json

PKG_DIRS := \
	$(PKGROOT)		\
	$(PKGDIRS_cabase)	\
	$(PKGDIRS_caconfigsvc)	\
	$(PKGDIRS_caaggsvc)	\
	$(PKGDIRS_cainstsvc)

ROOT_DIRS = \
	$(ROOT_CA)						\
	$(ROOT_CA)/cmd						\
	$(ROOT_CA)/cmd/caagg					\
	$(ROOT_CA)/cmd/caagg/transforms				\
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
	$(ROOT_CA)/deps/node-uname				\
	$(ROOT_CA)/deps/node-libGeoIP				\
	$(ROOT_CA)/lib						\
	$(ROOT_CA)/lib/ca					\
	$(ROOT_CA)/lib/tst					\
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
	$(ROOT_CA)/deps/node-png/png.node			\
	$(ROOT_CA)/deps/node-uname/uname.node			\
	$(ROOT_CA)/deps/node-libGeoIP/libGeoIP.node

CONNECT_FILES := $(shell cd deps/connect/lib && find connect -name '*.js')
ROOT_DEPFILES += $(CONNECT_FILES:%=$(ROOT_CA)/deps/connect/%)

NATIVE_DEPS = \
	deps/node/build/default/node				\
	deps/node-kstat/build/default/kstat.node		\
	deps/node-libdtrace/build/default/libdtrace.node	\
	deps/node-png/build/default/png.node			\
	deps/node-uname/build/default/uname.node		\
	deps/node-libGeoIP/build/default/libGeoIP.node

#
# Targets
#
all: $(WEBREV)/bin/codereview $(SRC)/deps/node-install $(NATIVE_DEPS) lib/ca/errno.js

$(SRC)/deps/node-install:
	mkdir -p $(SRC)/deps/node-install

deps/node/build/default/node:
	(cd deps/node && ./configure --prefix=$(SRC)/deps/node-install && make install)

%.node: $(NODE_WAF)
	(cd deps/node-$(*F) && $(NODE_WAF) configure && $(NODE_WAF) build)

lib/ca/errno.js: /usr/include/sys/errno.h
	$(MKERRNO) $^ > $@

#
# "check" targets check syntax for files
#
check-manifests: $(SMF_MANIFESTS)
	$(XMLLINT) --dtdvalid $(SMF_DTD) $(SMF_MANIFESTS)

check-shell: $(SH_SCRIPTS)
	$(BASH) -n $(SH_SCRIPTS)

check-jsl: check-jsl-main check-jsl-web

check-jsl-main: $(JS_FILES) $(DEMO_JSFILES) $(TST_JSFILES)
	$(JSL) --conf=$(JSL_CONF_MAIN) $(JS_FILES) $(DEMO_JSFILES) $(TST_JSFILES)

check-jsl-web: $(WEBJS_FILES)
	$(JSL) --conf=$(JSL_CONF_WEB) $(WEBJS_FILES)

check-jsstyle: $(JS_FILES) $(DEMO_JSFILES) $(WEBJS_FILES) $(TST_JSFILES)
	$(JSSTYLE) $(JS_FILES) $(DEMO_JSFILES) $(WEBJS_FILES) $(TST_JSFILES)

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
# Bulids necessary binary components for tools
#

$(WEBREV)/bin/codereview:
	$(CC) $(WEBREV)/src/lwlp.c -o $(WEBREV)/bin/codereview
	

#
# "pkg" target builds package tarball
#
pkg: $(PKG_TARBALLS)

$(PKGROOT)/cabase.tar.gz: install-cabase
	cd $(PKGROOT) && $(TAR) cf - cabase | gzip > cabase.tar.gz

$(PKGROOT)/caconfigsvc.tar.gz: install-caconfigsvc
	cd $(PKGROOT) && $(TAR) cf - caconfigsvc | gzip > caconfigsvc.tar.gz

$(PKGROOT)/caaggsvc.tar.gz: install-caaggsvc
	cd $(PKGROOT) && $(TAR) cf - caaggsvc | gzip > caaggsvc.tar.gz

$(PKGROOT)/cainstsvc.tar.gz: install-cainstsvc
	cd $(PKGROOT) && $(TAR) cf - cainstsvc | gzip > cainstsvc.tar.gz

#
# "install" target install files into the proto ("root") area
#
install: all install-rootdirs install-rootfiles install-deps \
    install-pkgs

install-rootdirs: $(ROOT_DIRS)

install-pkgdirs: $(PKG_DIRS)

install-pkgs: install-cabase install-caconfigsvc install-caaggsvc install-cainstsvc

install-cabase: all install-pkgdirs $(PKGFILES_cabase) $(PKGDEPS_cabase)

install-caconfigsvc: install-cabase $(PKGFILES_caconfigsvc) $(PKGDEPS_caconfigsvc)

install-caaggsvc: install-cabase $(PKGFILES_caaggsvc) $(PKGDEPS_caaggsvc)

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

$(PKGROOT)/caconfigsvc/%: %
	cp $^ $@

$(PKGROOT)/caaggsvc/%: %
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

$(ROOT_CA)/deps/node-uname/uname.node: deps/node-uname/build/default/uname.node
	cp $^ $@

$(ROOT_CA)/deps/node-libGeoIP/libGeoIP.node: deps/node-libGeoIP/build/default/libGeoIP.node
	cp $^ $@

$(ROOT_CA)/deps/node-libdtrace/libdtrace.node: deps/node-libdtrace/build/default/libdtrace.node
	cp $^ $@

$(ROOT_CA)/deps/node/node: deps/node-install/bin/node
	cp $^ $@

#
# The "release" target creates a ca-pkg.tar.bz2 suitable for release to the
# head-node. To formally release this, it should be copied to assets.joyent.us
# and placed into the /data/assets/templates/liveimg directory.  (Access
# assets.joyent.us via the user "jill", for which access is exclusively via
# authorized ssh key.)  That is, to formally release it, from build/dist:
#
#     scp ca-pkg*bz2 jill@assets.joyent.us:/data/assets/templates/liveimg
#
# Subsequent head-node builds will then pick up the new release.
#
release: pkg $(DIST) $(DIST)/ca-pkg.tar.bz2

$(DIST):
	mkdir -p $@

$(ROOT)/pkg:
	cd $(ROOT) && ln -s ../pkg .

$(DIST)/ca-pkg.tar.bz2: install $(ROOT)/pkg
	(cd $(BUILD) && $(TAR) chf - root/pkg/*.gz) | \
	    bzip2 > $(DIST)/ca-pkg.tar.bz2

#
# "clean" target removes created files -- we currently have none
#
clean:
	-rm -f lib/ca/errno.js
	-rm -f $(WEBREV)/bin/codereview 

#
# "dist-clean" target removes installed root and built dependencies
#
dist-clean: clean
	-(cd deps/node-kstat && $(NODE_WAF) distclean)
	-(cd deps/node-libdtrace && $(NODE_WAF) distclean)
	-(cd deps/node-png && $(NODE_WAF) distclean)
	-(cd deps/node-uname && $(NODE_WAF) distclean)
	-(cd deps/node-libGeoIP && $(NODE_WAF) distclean)
	-(cd deps/node && $(MAKE) distclean)
	-$(RMTREE) $(BUILD) deps/node-install
