/**
 * This bundle's own entry on the Plugins page.
 *
 * Split out of `client.js` as a package-local chunk: the card is a whole settings
 * surface — three groups, three disclosures, a staged form — and it is the one
 * mount that renders without the panel, so it carries its own copy of the
 * stylesheet. It is bound during apply, once the primitives are known to exist.
 *
 * @module GitPanel/client.settings
 */
window.__ModuleLoader__.load({
  id: 'GitPanel',
  chunk: 'client.settings.js',
  factory: () => ({ create: (shared) => {
    const {
      h, React, primitives, StyleTag,
      SETTINGS_NS, DEPTH_FIELD, DEPTH_INPUT_ID, DISCOVERY_SECTION_ID,
      WHOLE_FILE_FIELD, WHOLE_FILE_SPEC, WHOLE_FILE_HELP_ID, DISPLAY_SECTION_ID,
      FILE_PREVIEW_FIELD, FILE_PREVIEW_SPEC, FILE_PREVIEW_HELP_ID, FILE_PREVIEW_SECTION_ID,
    } = shared

    /**
     * The two paragraphs every settings explanation is made of.
     *
     * The first says what the setting does; the second states its bounds and
     * what turning it on costs. Both fields use it, so their disclosures read
     * the same whether the primitive draws them or the card does.
     *
     * @param {string} body - what the setting does.
     * @param {string} note - its bounds and its cost.
     * @returns {object} the disclosure's content.
     */
    function helpParagraphs(body, note) {
      return h(React.Fragment, null, h('p', null, body), h('p', null, note))
    }

    /**
     * The Git plugin's configuration card.
     *
     * The Plugins page renders a bundle's own configuration on that bundle's
     * page, keyed by the package name, between its description and its rows — so
     * this is what opening `GitPanel` in the installed group shows. The body
     * is the shared settings form: it stages what the user types and writes it
     * only on save, which is the page's own contract — the plugin never commits
     * a value the user did not confirm.
     *
     * The controls are the shared ones the built-in settings pages use — the
     * value field for the depth and the switch in a label row for the boolean —
     * so this card reads as one more page of the same settings surface rather
     * than a hand-drawn form.
     *
     * @param {object} props - the form snapshot and the form actions.
     * @returns {object} the form.
     */
    function GitSettingsCard(props) {
      const { t } = props
      const state = props.useGitSettings((snapshot) => snapshot)
      const [wholeFileHelp, setWholeFileHelp] = React.useState(false)
      const [filePreviewHelp, setFilePreviewHelp] = React.useState(false)
      // A cleared draft inherits the composition default (off), so the switch
      // previews the value a save would leave rather than the raw draft text.
      const wholeFile = state[WHOLE_FILE_FIELD].text === 'true'
      // This field's composition default is the reverse: a cleared draft means
      // the repair is on, so only the literal `false` reads as off.
      const filePreview = state[FILE_PREVIEW_FIELD].text !== 'false'
      return h(
        primitives.SettingsForm,
        {
          labels: {
            unavailable: t('settings.unavailable'),
            readOnly: t('settings.readOnly'),
            saveFailed: t('settings.saveFailed'),
            save: t('settings.save'),
            saving: t('settings.saving'),
          },
          state,
          onSave: props.save,
          onDiscard: props.discard,
        },
        // This card is a separate mount from the panel and the tab door, so it
        // carries its own copy of the token-only stylesheet: without it none of
        // the `git-panel-config-*` rules apply here and the card falls back to
        // the surrounding page's type, which is exactly what made the two
        // explanations disagree.
        h(StyleTag, null),
        h(
          'section',
          { className: 'git-panel-config-section', 'aria-labelledby': DISCOVERY_SECTION_ID },
          h('h3', { className: 'git-panel-config-heading', id: DISCOVERY_SECTION_ID }, t('config.discovery')),
          h(
            'div',
            { className: 'git-panel-config-grid' },
            h(primitives.SettingsValueField, {
              id: DEPTH_INPUT_ID,
              label: t('depth'),
              // The explanation lives behind the info button beside the label,
              // the way the built-in settings pages disclose a field's rules.
              help: { label: t('depth.help'), content: helpParagraphs(t('depth.help.body'), t('depth.help.note')) },
              overriddenLabel: t('settings.overridden'),
              resetLabel: t('settings.reset'),
              invalidLabel: t('settings.invalidNumber'),
              numeric: true,
              disabled: state.writable !== true,
              text: state[DEPTH_FIELD].text,
              overridden: state[DEPTH_FIELD].overridden,
              invalid: state[DEPTH_FIELD].invalid,
              onEdit: (text) => props.edit(DEPTH_FIELD, text),
              onReset: () => props.resetField(DEPTH_FIELD),
            }),
          ),
        ),
        h(
          'section',
          { className: 'git-panel-config-section', 'aria-labelledby': DISPLAY_SECTION_ID },
          h('h3', { className: 'git-panel-config-heading', id: DISPLAY_SECTION_ID }, t('config.display')),
          h(
            'div',
            { className: 'git-panel-config-toggle' },
            h(
              'div',
              { className: 'git-panel-config-toggle-row' },
              h(
                'div',
                { className: 'git-panel-config-toggle-label' },
                h('span', null, t('wholeFileDiff')),
                // A switch has no field primitive to draw its info button, so
                // it is mirrored here: both settings disclose their rules the
                // same way, in the same place, with the same type.
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'git-panel-config-help-button',
                    'aria-label': t('wholeFileDiff.help'),
                    'aria-expanded': wholeFileHelp,
                    'aria-controls': WHOLE_FILE_HELP_ID,
                    onClick: () => setWholeFileHelp(wholeFileHelp !== true),
                  },
                  h(primitives.IconInfoOutlineRegular, { size: 12 }),
                ),
              ),
              state[WHOLE_FILE_FIELD].overridden
                ? h(
                    'span',
                    { className: 'git-panel-config-badges' },
                    h(primitives.Tag, { tone: 'neutral' }, t('settings.overridden')),
                    h('button', { type: 'button', className: 'git-panel-config-reset', disabled: state.writable !== true, onClick: () => props.resetField(WHOLE_FILE_FIELD) }, t('settings.reset')),
                  )
                : null,
              h(primitives.Switch, {
                checked: wholeFile,
                label: t('wholeFileDiff'),
                disabled: state.writable !== true,
                onChange: (next) => props.edit(WHOLE_FILE_FIELD, next === true ? 'true' : 'false'),
              }),
            ),
            wholeFileHelp === true
              ? h(
                  'div',
                  { id: WHOLE_FILE_HELP_ID, className: 'git-panel-config-help', role: 'region', 'aria-label': t('wholeFileDiff.help') },
                  helpParagraphs(t('wholeFileDiff.help.body'), t('wholeFileDiff.help.note')),
                )
              : null,
          ),
        ),
        h(
          'section',
          { className: 'git-panel-config-section', 'aria-labelledby': FILE_PREVIEW_SECTION_ID },
          h('h3', { className: 'git-panel-config-heading', id: FILE_PREVIEW_SECTION_ID }, t('config.preview')),
          h(
            'div',
            { className: 'git-panel-config-toggle' },
            h(
              'div',
              { className: 'git-panel-config-toggle-row' },
              h(
                'div',
                { className: 'git-panel-config-toggle-label' },
                h('span', null, t('filePreviewFix')),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'git-panel-config-help-button',
                    'aria-label': t('filePreviewFix.help'),
                    'aria-expanded': filePreviewHelp,
                    'aria-controls': FILE_PREVIEW_HELP_ID,
                    onClick: () => setFilePreviewHelp(filePreviewHelp !== true),
                  },
                  h(primitives.IconInfoOutlineRegular, { size: 12 }),
                ),
              ),
              state[FILE_PREVIEW_FIELD].overridden
                ? h(
                    'span',
                    { className: 'git-panel-config-badges' },
                    h(primitives.Tag, { tone: 'neutral' }, t('settings.overridden')),
                    h('button', { type: 'button', className: 'git-panel-config-reset', disabled: state.writable !== true, onClick: () => props.resetField(FILE_PREVIEW_FIELD) }, t('settings.reset')),
                  )
                : null,
              h(primitives.Switch, {
                checked: filePreview,
                label: t('filePreviewFix'),
                disabled: state.writable !== true,
                onChange: (next) => props.edit(FILE_PREVIEW_FIELD, next === true ? 'true' : 'false'),
              }),
            ),
            filePreviewHelp === true
              ? h(
                  'div',
                  { id: FILE_PREVIEW_HELP_ID, className: 'git-panel-config-help', role: 'region', 'aria-label': t('filePreviewFix.help') },
                  helpParagraphs(t('filePreviewFix.help.body'), t('filePreviewFix.help.note')),
                )
              : null,
          ),
        ),
      )
    }

    /**
     * Build the Plugins page card's staged form over this plugin's settings.
     *
     * @param {object} configForms - the client configuration-form service.
     * @returns {{ inject: Function, dispose: Function }} the card's slot face and its disposer.
     */
    function createSettingsCard(configForms) {
      const form = new primitives.SettingsFormModel(configForms.get(SETTINGS_NS), [primitives.settingsNumberField(DEPTH_FIELD), WHOLE_FILE_SPEC, FILE_PREVIEW_SPEC])
      const store = form.bind(() => ({
        ...form.shell(),
        [DEPTH_FIELD]: form.field(DEPTH_FIELD),
        [WHOLE_FILE_FIELD]: form.field(WHOLE_FILE_FIELD),
        [FILE_PREVIEW_FIELD]: form.field(FILE_PREVIEW_FIELD),
      }))
      return {
        /**
         * The face the card's slot registration injects.
         *
         * @returns {object} the snapshot hook the card reads and the form actions.
         */
        inject() {
          return { hooks: { gitSettings: store }, ...form.actions() }
        },
        /** Release the form's subscription to the settings document. */
        dispose() {
          form.dispose()
        },
      }
    }

    return { helpParagraphs, GitSettingsCard, createSettingsCard }
  } }),
})
