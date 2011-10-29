/*
 * heap-dbg-common.h: structure, constant, and macro definitions for use by
 *   V8 heap inspection tools.  These declarations are used in conjunction with
 *   the heap-dbg-inl.h file that's generated as part of the build process to
 *   describe the layout of heap objects for a particular version of V8.
 */

#ifndef HEAPDBG_COMMON_H
#define	HEAPDBG_COMMON_H

typedef struct v8_class {
	const char *v8c_name;		/* heap object class name */
	struct v8_class *v8c_parent;	/* parent class (inheritance) */
	struct v8_field *v8c_fields;	/* array of class fields */
	size_t v8c_start;		/* offset of first class field */
	size_t v8c_end;			/* offset of first subclass field */
} v8_class_t;

typedef struct v8_field {
	const char 	*v8f_name;	/* field name */
	const size_t	v8f_offset;	/* field offset */
	const size_t	v8f_size;	/* field size */
} v8_field_t;

/*
 * We use the Heap::roots_ object to find various special values (like
 * "undefined", "null", etc.)
 */
#define	V8_HEAP_ROOTS_SYM		"_ZN2v88internal4Heap6roots_E"

/*
 * See node_string.h.
 */
#define	NODE_OFF_EXTSTR_DATA		0x4

/*
 * Recall that while V8 heap objects are always 4-byte aligned, heap object
 * pointers always have the last bit set.  Rather than modify the pointers
 * everywhere we use them, we provide the V8_OFF_HEAP macro to adjust the offset
 * definitions (as V8 does internally -- see the READ_FIELD() and FIELD_ADDR()
 * macros in v8/src/objects-inl.h.)
 */
#define	V8_OFF_HEAP(x)			((x) - V8_HeapObjectTag)

/*
 * Recall that small integers are stored using the upper 32 bits.
 * XXX define macros for ISSTRING, ISSMI, ISHEAPOBJECT, ISFAILURE?
 */
#define	V8_SMI_VALUE(smi)		((smi) >> V8_SmiValueShift)

#include <sys/types.h>

typedef uintptr_t Smi;

#endif
