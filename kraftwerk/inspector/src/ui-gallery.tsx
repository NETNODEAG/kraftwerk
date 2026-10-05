import { useState } from "react";
import {
  Avatar, Badge, Button, Checkbox, Dot, EmptyState, Fact, Facts, Field, FieldRow, FormStack, Hint, IconButton, Kbd, ListRow, Notice, PageHeader,
  Panel, PanelRow, PanelRows, Popover, Section, Select, SideHead, SideList, SideNote, SideSearch, Switch, SwitchRow, Tabs, Tag, TextArea, TextField, Title,
} from "./ui";

/** #/ui: every component of src/ui/ once, in both themes' tokens, for review. Not linked anywhere. */
export function UiGallery() {
  const [tab, setTab] = useState<"overview" | "files" | "knowledge">("overview");
  const [on, setOn] = useState(true);
  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-4 p-6">
      <PageHeader title="Components" sub="src/ui — what every screen is built from" actions={<Button variant="primary" icon="add">primary</Button>} />
      <div className="grid grid-cols-2 gap-4">
        <Panel title="Buttons">
          <div className="flex flex-wrap items-center gap-2 p-4">
            <Button variant="primary" icon="play_arrow">Run</Button>
            <Button variant="secondary" icon="upload">Upload</Button>
            <Button variant="quiet" icon="create_new_folder">Folder</Button>
            <Button variant="danger" icon="delete">Move to trash</Button>
            <Button variant="primary" busy>Saving</Button>
            <Button variant="secondary" disabled>Disabled</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 px-4 pb-4">
            <Button size="sm" variant="primary">small</Button>
            <Button size="sm" variant="secondary">small</Button>
            <Button size="sm" variant="quiet">small</Button>
            <IconButton icon="edit" label="Rename" />
            <IconButton icon="download" label="Download" />
            <IconButton icon="delete" label="Delete" variant="danger" />
            <IconButton icon="close" label="Close" size="sm" />
          </div>
        </Panel>
        <Panel title="Status">
          <div className="flex flex-wrap items-center gap-3 p-4">
            <Badge n={3} /> <Badge n={12} tone="neutral" />
            <Dot tone="ok" /> <Dot tone="bad" /> <Dot tone="ask" /> <Dot tone="live" /> <Dot tone="working" /> <Dot tone="idle" />
            <Tag>static</Tag> <Tag tone="ok">done</Tag> <Tag tone="bad">failed</Tag> <Tag tone="ask">needs approval</Tag> <Tag tone="accent">running</Tag>
          </div>
          <Notice tone="bad">Could not upload brief.pdf</Notice>
          <Notice>uploading 2 of 3…</Notice>
        </Panel>
        <Panel title="Rows" count={1} actions={<Button size="sm" variant="quiet" icon="arrow_forward">all</Button>}>
          <div className="p-1.5">
            <ListRow leading="🐻" title="Max" sub="waiting for you · Set up the build" subTone="bad" titleExtra={<Badge n={1} />} href="/ui" />
            <ListRow leading="🦊" title="Lisa" sub="last active 2h ago" href="/ui" active />
            <ListRow leading={<span className="ms material-symbols-rounded ms-sm">folder</span>} title="briefing" meta="3 files" onClick={() => {}} actions={<IconButton icon="edit" label="Rename" size="sm" />} />
            <ListRow leading={<Dot tone="working" />} title="website-check" sub="https://netnode.ch" meta="running" size="sm" />
            <ListRow leading="📁" title="Gone project" sub="not in this workspace" dim />
          </div>
        </Panel>
        <Panel title="Tabs and sections">
          <Tabs items={[{ id: "overview", label: "overview" }, { id: "files", label: "files", count: 4 }, { id: "knowledge", label: "knowledge", count: 0 }]} value={tab} onChange={setTab} />
          <div className="p-2">
            <Section size="lg" title="needs you" count={2} action={<Button size="sm" variant="quiet">all</Button>}>
              <ListRow leading="✋" title="Run npm install" sub="🐻 Max · needs approval · 4m ago" onClick={() => {}} />
            </Section>
            <Section title="team">
              <ListRow leading="🦊" title="Lisa" sub="Research" />
            </Section>
          </div>
        </Panel>
        <Panel title="Fields">
          <div className="flex flex-col gap-3 p-4">
            <Field label="Name" hint="Shown in the rail.">
              <TextField placeholder="e.g. Max" />
            </Field>
            <Field label="Harness">
              <Select defaultValue="claude"><option>claude</option><option>codex</option><option>pi</option></Select>
            </Field>
            <Field label="Role">
              <TextArea rows={3} placeholder="What this agent does" />
            </Field>
          </div>
        </Panel>
        <Panel title="Empty and menus">
          <EmptyState icon="upload_file" action={<Button variant="secondary" size="sm" icon="upload">choose files</Button>}>Drop files here.</EmptyState>
          <div className="p-4">
            <Popover trigger={({ toggle }) => <Button onClick={toggle} icon="expand_more">menu</Button>}>
              {(close) => (
                <div className="flex flex-col">
                  <ListRow leading="⚙️" title="Settings" onClick={close} size="sm" />
                  <ListRow leading="🗑" title="Trash" onClick={close} size="sm" />
                </div>
              )}
            </Popover>
          </div>
        </Panel>
        <Panel title="Sidebar parts">
          <div className="w-[300px] border-r border-line">
            <SideHead title="workflows" count={3} action={<Button size="sm" variant="quiet" icon="add">new</Button>} />
            <SideSearch placeholder="search workflows" aria-label="search workflows" />
            <SideList>
              <ListRow leading={<Dot tone="ok" />} title="triage" sub="checks, drafts, publishes" size="sm" active />
              <SideNote>no workflow matches “x”</SideNote>
            </SideList>
          </div>
        </Panel>
        <Panel title="Choices">
          <FormStack>
            <Checkbox checked={on} onChange={setOn} hint="every discovered skill">all skills</Checkbox>
            <Checkbox checked={!on} onChange={(v) => setOn(!v)} hint="0 concepts" mono>brand-guide</Checkbox>
            <FieldRow>
              <Switch checked={on} onChange={setOn} label="routine enabled" />
              <Hint>Hint: a small explaining line. Keys look like <Kbd>⌘K</Kbd>.</Hint>
            </FieldRow>
            <SwitchRow label="Docker sandbox" hint="Docker is not running" checked={on} onChange={setOn} />
          </FormStack>
        </Panel>
        <Panel title="Page parts">
          <div className="flex flex-col gap-3 p-4">
            <div className="flex items-center gap-3">
              <Avatar>🐻</Avatar>
              <Title size="lg">Max</Title>
              <Tag href="#/ui">linked tag</Tag>
            </div>
            <Tabs bare label="link tabs" value="pages" items={[{ id: "pages", label: "pages", href: "/ui" }, { id: "activity", label: "activity", href: "/ui" }]} />
          </div>
          <PanelRows>
            <PanelRow icon="account_tree" title="workflows" action={<Button size="sm">edit</Button>}>
              <span className="text-xs text-fg-2">none connected</span>
            </PanelRow>
            <PanelRow icon="menu_book" title="knowledge" />
          </PanelRows>
          <Facts>
            <Fact label="source">workspace</Fact>
            <Fact label="path" mono>skills/release-notes/SKILL.md</Fact>
          </Facts>
        </Panel>
      </div>
    </div>
  );
}
