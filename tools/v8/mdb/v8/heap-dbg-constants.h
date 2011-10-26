/*
 * heap-dbg-inl.h: auto-generated.  Do not edit directly.
 * See heap-dbg-common.h for details. */

#include "heap-dbg-common.h"

/* JSArray class constants */
#define	V8_OFF_JSArray_length	(V8_OFF_HEAP(0xc))

/* String class constants */
#define	V8_OFF_String_length	(V8_OFF_HEAP(0x4))

/* ByteArray class constants */
#define	V8_OFF_ByteArray_length	(V8_OFF_HEAP(0x4))

/* JSFunction class constants */
#define	V8_OFF_JSFunction_prototype_or_initial_map	(V8_OFF_HEAP(0x10))
#define	V8_OFF_JSFunction_shared	(V8_OFF_HEAP(0x14))
#define	V8_OFF_JSFunction_literals	(V8_OFF_HEAP(0x1c))
#define	V8_OFF_JSFunction_next_function_link	(V8_OFF_HEAP(0x20))

/* JSGlobalProxy class constants */
#define	V8_OFF_JSGlobalProxy_context	(V8_OFF_HEAP(0xc))

/* AccessCheckInfo class constants */
#define	V8_OFF_AccessCheckInfo_named_callback	(V8_OFF_HEAP(0x4))
#define	V8_OFF_AccessCheckInfo_indexed_callback	(V8_OFF_HEAP(0x8))
#define	V8_OFF_AccessCheckInfo_data	(V8_OFF_HEAP(0xc))

/* JSValue class constants */
#define	V8_OFF_JSValue_value	(V8_OFF_HEAP(0xc))

/* Map class constants */
#define	V8_OFF_Map_constructor	(V8_OFF_HEAP(0x10))
#define	V8_OFF_Map_instance_descriptors	(V8_OFF_HEAP(0x14))
#define	V8_OFF_Map_code_cache	(V8_OFF_HEAP(0x18))

/* FixedArray class constants */
#define	V8_OFF_FixedArray_length	(V8_OFF_HEAP(0x4))

/* GlobalObject class constants */
#define	V8_OFF_GlobalObject_builtins	(V8_OFF_HEAP(0xc))
#define	V8_OFF_GlobalObject_global_context	(V8_OFF_HEAP(0x10))
#define	V8_OFF_GlobalObject_global_receiver	(V8_OFF_HEAP(0x14))

/* TypeSwitchInfo class constants */
#define	V8_OFF_TypeSwitchInfo_types	(V8_OFF_HEAP(0x4))

/* ObjectTemplateInfo class constants */
#define	V8_OFF_ObjectTemplateInfo_constructor	(V8_OFF_HEAP(0xc))
#define	V8_OFF_ObjectTemplateInfo_internal_field_count	(V8_OFF_HEAP(0x10))

/* JSObject class constants */
#define	V8_OFF_JSObject_properties	(V8_OFF_HEAP(0x4))
#define	V8_OFF_JSObject_elements	(V8_OFF_HEAP(0x8))

/* Oddball class constants */
#define	V8_OFF_Oddball_to_string	(V8_OFF_HEAP(0x4))
#define	V8_OFF_Oddball_to_number	(V8_OFF_HEAP(0x8))

/* BreakPointInfo class constants */
#define	V8_OFF_BreakPointInfo_code_position	(V8_OFF_HEAP(0x4))
#define	V8_OFF_BreakPointInfo_source_position	(V8_OFF_HEAP(0x8))
#define	V8_OFF_BreakPointInfo_statement_position	(V8_OFF_HEAP(0xc))
#define	V8_OFF_BreakPointInfo_break_point_objects	(V8_OFF_HEAP(0x10))

/* AccessorInfo class constants */
#define	V8_OFF_AccessorInfo_getter	(V8_OFF_HEAP(0x4))
#define	V8_OFF_AccessorInfo_setter	(V8_OFF_HEAP(0x8))
#define	V8_OFF_AccessorInfo_data	(V8_OFF_HEAP(0xc))
#define	V8_OFF_AccessorInfo_name	(V8_OFF_HEAP(0x10))
#define	V8_OFF_AccessorInfo_flag	(V8_OFF_HEAP(0x14))

/* HeapObject class constants */
#define	V8_OFF_HeapObject_map	(V8_OFF_HEAP(0x0))

/* JSRegExp class constants */
#define	V8_OFF_JSRegExp_data	(V8_OFF_HEAP(0xc))

/* TemplateInfo class constants */
#define	V8_OFF_TemplateInfo_tag	(V8_OFF_HEAP(0x4))
#define	V8_OFF_TemplateInfo_property_list	(V8_OFF_HEAP(0x8))

/* SignatureInfo class constants */
#define	V8_OFF_SignatureInfo_receiver	(V8_OFF_HEAP(0x4))
#define	V8_OFF_SignatureInfo_args	(V8_OFF_HEAP(0x8))

/* DebugInfo class constants */
#define	V8_OFF_DebugInfo_shared	(V8_OFF_HEAP(0x4))
#define	V8_OFF_DebugInfo_original_code	(V8_OFF_HEAP(0x8))
#define	V8_OFF_DebugInfo_code	(V8_OFF_HEAP(0xc))
#define	V8_OFF_DebugInfo_break_points	(V8_OFF_HEAP(0x14))

/* CallHandlerInfo class constants */
#define	V8_OFF_CallHandlerInfo_callback	(V8_OFF_HEAP(0x4))
#define	V8_OFF_CallHandlerInfo_data	(V8_OFF_HEAP(0x8))

/* Code class constants */
#define	V8_OFF_Code_relocation_info	(V8_OFF_HEAP(0x8))
#define	V8_OFF_Code_deoptimization_data	(V8_OFF_HEAP(0xc))

/* SharedFunctionInfo class constants */
#define	V8_OFF_SharedFunctionInfo_name	(V8_OFF_HEAP(0x4))
#define	V8_OFF_SharedFunctionInfo_construct_stub	(V8_OFF_HEAP(0x10))
#define	V8_OFF_SharedFunctionInfo_instance_class_name	(V8_OFF_HEAP(0x14))
#define	V8_OFF_SharedFunctionInfo_function_data	(V8_OFF_HEAP(0x18))
#define	V8_OFF_SharedFunctionInfo_script	(V8_OFF_HEAP(0x1c))
#define	V8_OFF_SharedFunctionInfo_debug_info	(V8_OFF_HEAP(0x20))
#define	V8_OFF_SharedFunctionInfo_inferred_name	(V8_OFF_HEAP(0x24))
#define	V8_OFF_SharedFunctionInfo_initial_map	(V8_OFF_HEAP(0x28))
#define	V8_OFF_SharedFunctionInfo_this_property_assignments	(V8_OFF_HEAP(0x2c))
#define	V8_OFF_SharedFunctionInfo_length	(V8_OFF_HEAP(0x34))
#define	V8_OFF_SharedFunctionInfo_formal_parameter_count	(V8_OFF_HEAP(0x38))
#define	V8_OFF_SharedFunctionInfo_expected_nof_properties	(V8_OFF_HEAP(0x3c))
#define	V8_OFF_SharedFunctionInfo_num_literals	(V8_OFF_HEAP(0x40))
#define	V8_OFF_SharedFunctionInfo_start_position_and_type	(V8_OFF_HEAP(0x44))
#define	V8_OFF_SharedFunctionInfo_end_position	(V8_OFF_HEAP(0x48))
#define	V8_OFF_SharedFunctionInfo_function_token_position	(V8_OFF_HEAP(0x4c))
#define	V8_OFF_SharedFunctionInfo_compiler_hints	(V8_OFF_HEAP(0x50))
#define	V8_OFF_SharedFunctionInfo_this_property_assignments_count	(V8_OFF_HEAP(0x54))
#define	V8_OFF_SharedFunctionInfo_opt_count	(V8_OFF_HEAP(0x58))

/* JSMessageObject class constants */
#define	V8_OFF_JSMessageObject_type	(V8_OFF_HEAP(0xc))
#define	V8_OFF_JSMessageObject_arguments	(V8_OFF_HEAP(0x10))
#define	V8_OFF_JSMessageObject_script	(V8_OFF_HEAP(0x14))
#define	V8_OFF_JSMessageObject_stack_trace	(V8_OFF_HEAP(0x18))
#define	V8_OFF_JSMessageObject_stack_frames	(V8_OFF_HEAP(0x1c))
#define	V8_OFF_JSMessageObject_start_position	(V8_OFF_HEAP(0x20))
#define	V8_OFF_JSMessageObject_end_position	(V8_OFF_HEAP(0x24))

/* Script class constants */
#define	V8_OFF_Script_source	(V8_OFF_HEAP(0x4))
#define	V8_OFF_Script_name	(V8_OFF_HEAP(0x8))
#define	V8_OFF_Script_line_offset	(V8_OFF_HEAP(0xc))
#define	V8_OFF_Script_column_offset	(V8_OFF_HEAP(0x10))
#define	V8_OFF_Script_data	(V8_OFF_HEAP(0x14))
#define	V8_OFF_Script_context_data	(V8_OFF_HEAP(0x18))
#define	V8_OFF_Script_wrapper	(V8_OFF_HEAP(0x1c))
#define	V8_OFF_Script_type	(V8_OFF_HEAP(0x20))
#define	V8_OFF_Script_compilation_type	(V8_OFF_HEAP(0x24))
#define	V8_OFF_Script_line_ends	(V8_OFF_HEAP(0x28))
#define	V8_OFF_Script_id	(V8_OFF_HEAP(0x2c))
#define	V8_OFF_Script_eval_from_shared	(V8_OFF_HEAP(0x30))
#define	V8_OFF_Script_eval_from_instructions_offset	(V8_OFF_HEAP(0x34))

/* InterceptorInfo class constants */
#define	V8_OFF_InterceptorInfo_getter	(V8_OFF_HEAP(0x4))
#define	V8_OFF_InterceptorInfo_setter	(V8_OFF_HEAP(0x8))
#define	V8_OFF_InterceptorInfo_query	(V8_OFF_HEAP(0xc))
#define	V8_OFF_InterceptorInfo_deleter	(V8_OFF_HEAP(0x10))
#define	V8_OFF_InterceptorInfo_enumerator	(V8_OFF_HEAP(0x14))
#define	V8_OFF_InterceptorInfo_data	(V8_OFF_HEAP(0x18))

/* FunctionTemplateInfo class constants */
#define	V8_OFF_FunctionTemplateInfo_serial_number	(V8_OFF_HEAP(0xc))
#define	V8_OFF_FunctionTemplateInfo_call_code	(V8_OFF_HEAP(0x10))
#define	V8_OFF_FunctionTemplateInfo_property_accessors	(V8_OFF_HEAP(0x14))
#define	V8_OFF_FunctionTemplateInfo_prototype_template	(V8_OFF_HEAP(0x18))
#define	V8_OFF_FunctionTemplateInfo_parent_template	(V8_OFF_HEAP(0x1c))
#define	V8_OFF_FunctionTemplateInfo_named_property_handler	(V8_OFF_HEAP(0x20))
#define	V8_OFF_FunctionTemplateInfo_indexed_property_handler	(V8_OFF_HEAP(0x24))
#define	V8_OFF_FunctionTemplateInfo_instance_template	(V8_OFF_HEAP(0x28))
#define	V8_OFF_FunctionTemplateInfo_class_name	(V8_OFF_HEAP(0x2c))
#define	V8_OFF_FunctionTemplateInfo_signature	(V8_OFF_HEAP(0x30))
#define	V8_OFF_FunctionTemplateInfo_instance_call_handler	(V8_OFF_HEAP(0x34))
#define	V8_OFF_FunctionTemplateInfo_access_check_info	(V8_OFF_HEAP(0x38))
#define	V8_OFF_FunctionTemplateInfo_flag	(V8_OFF_HEAP(0x3c))

/* CodeCache class constants */
#define	V8_OFF_CodeCache_default_cache	(V8_OFF_HEAP(0x4))
#define	V8_OFF_CodeCache_normal_type_cache	(V8_OFF_HEAP(0x8))

