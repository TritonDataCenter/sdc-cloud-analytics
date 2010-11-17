#
# Makefile: top-level makefile
#

#
# Directories
#
TOOLSDIR=tools
JS_SUBDIRS=cmd lib

#
# Tools
#
CSCOPE=cscope
JSL=$(TOOLSDIR)/jsl
JSSTYLE=$(TOOLSDIR)/jsstyle

#
# Files
#
JS_FILES= `find $(JS_SUBDIRS) -name '*.js'`

#
# Targets
#
all:
	

check-jsl:
	$(JSL) $(JS_FILES)

check-jsstyle:
	$(JSSTYLE) $(JS_FILES)

check: check-jsstyle check-jsl

cscope.files:
	find $(JS_SUBDIRS) -name '*.js' > cscope.files

xref: cscope.files
	$(CSCOPE) -bqR
