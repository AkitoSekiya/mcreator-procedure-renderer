/**
 * Registers the 7 MCreator-specific custom field types listed in
 * blocks_render.json's `custom_field_types` (SPEC.md §5.2). The workspace is
 * always `readOnly: true`, so none of these need real editing behaviour —
 * they only need to (a) accept `fromJson` construction without crashing
 * (block definitions that reference them would otherwise throw on
 * registration and take the whole app down), and (b) display whatever value
 * gets applied later via `setValue`/XML loading.
 *
 * Three of them (`field_data_list_selector`, `field_data_list_dropdown`,
 * `field_ai_condition_selector`) are rendered as a dropdown showing only the
 * current value, so they get the "value + ▼" look of the real MCreator
 * field. The rest are rendered as a bordered text field.
 */
import * as Blockly from 'blockly/core';

/** Menu generator used by dropdown-like custom fields: always exactly one
 * option, reflecting whatever the field's current value is. */
function currentValueMenuGenerator(this: Blockly.FieldDropdown): Blockly.MenuOption[] {
  const v = this.getValue();
  const value = typeof v === 'string' ? v : '';
  const label = value.length > 0 ? value : '(未設定)';
  return [[label, value]];
}

/**
 * A FieldDropdown whose only "option" is always its own current value, so it
 * always renders as a valid selection (value + arrow) regardless of what
 * value is later assigned to it (e.g. via `<field>` XML loading) without
 * needing the real MCreator datalist data.
 */
class SingleValueDropdownField extends Blockly.FieldDropdown {
  constructor(value = '') {
    super(currentValueMenuGenerator);
    this.setValue(value);
  }

  // The validator always lets the value through, per SPEC.md §5.2 — this
  // field never has a real, closed set of options to validate against.
  protected doClassValidation_(newValue?: string): string | null {
    return typeof newValue === 'string' ? newValue : '';
  }

  protected getText_(): string | null {
    const v = this.getValue();
    return typeof v === 'string' ? v : '';
  }

  static fromJson(_options: Blockly.FieldDropdownFromJsonConfig): SingleValueDropdownField {
    return new SingleValueDropdownField('');
  }
}

/** Plain bordered text field used for the remaining custom field types. */
class SimpleTextField extends Blockly.FieldTextInput {
  static fromJson(options: Blockly.FieldTextInputFromJsonConfig): SimpleTextField {
    const text = typeof options.text === 'string' ? options.text : '';
    return new SimpleTextField(text);
  }
}

/** Like SimpleTextField, but collapses newlines to "⏎" for single-line
 * display (SPEC.md §5.2 / §8 known limitation: multiline text is not
 * rendered as multiple lines). */
class MultilineTextField extends Blockly.FieldTextInput {
  protected getText_(): string | null {
    const v = this.getValue();
    return typeof v === 'string' ? v.replace(/\r\n|\r|\n/g, '⏎') : null;
  }

  static fromJson(options: Blockly.FieldTextInputFromJsonConfig): MultilineTextField {
    const text = typeof options.text === 'string' ? options.text : '';
    return new MultilineTextField(text);
  }
}

let registered = false;

/** Registers all 7 custom field types. Safe to call multiple times. */
export function registerCustomFields(): void {
  if (registered) return;
  registered = true;

  Blockly.fieldRegistry.register('field_data_list_selector', SingleValueDropdownField);
  Blockly.fieldRegistry.register('field_data_list_dropdown', SingleValueDropdownField);
  Blockly.fieldRegistry.register('field_ai_condition_selector', SingleValueDropdownField);

  Blockly.fieldRegistry.register('field_mcitem_selector', SimpleTextField);
  Blockly.fieldRegistry.register('field_javaname', SimpleTextField);
  Blockly.fieldRegistry.register('field_resourcelocation', SimpleTextField);

  Blockly.fieldRegistry.register('field_multilinetext', MultilineTextField);
}
