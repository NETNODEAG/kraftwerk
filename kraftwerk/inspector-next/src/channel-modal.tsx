import { useState } from "react";
import { saveChannel, type Agent, type Channel } from "./api";
import { Modal } from "./modal";

/**
 * Create or edit a channel: a shared conversation, the agents in it, and who
 * answers when nobody is mentioned. `channel` undefined = a new one.
 */
export function ChannelModal({ channel, agents, onClose, onSaved }: {
  channel?: Channel;
  agents: Agent[];
  onClose: () => void;
  onSaved: (channel: Channel, created: boolean) => void;
}) {
  const [name, setName] = useState(channel?.name ?? "");
  const [purpose, setPurpose] = useState(channel?.purpose ?? "");
  const [members, setMembers] = useState<string[]>(channel?.members ?? []);
  const [responder, setResponder] = useState(channel?.responder ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // The responder has to be in the channel: leaving it takes the role along.
  const answering = members.includes(responder) ? responder : "";
  // The server refuses a channel without agents; say so before it has to.
  const complete = !!name.trim() && members.length > 0;

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      onSaved(await saveChannel({ slug: channel?.slug, name: name.trim(), purpose: purpose.trim(), members, responder: answering }), !channel);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  return (
    <Modal
      title={channel ? "Edit channel" : "New channel"}
      onClose={onClose}
      onSubmit={() => complete && !saving && void save()}
      footer={
        <>
          <button type="button" className="quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!complete || saving}>
            {saving ? "Saving…" : channel ? "Save" : "Create channel"}
          </button>
        </>
      }
    >
      <div className="modal-fields">
        <label className="field">
          <span>Name</span>
          <input value={name} autoFocus={!channel} placeholder="e.g. Website relaunch" onChange={(e) => setName(e.target.value)} />
        </label>

        <label className="field">
          <span>What it is for</span>
          <input value={purpose} placeholder="One line, optional" onChange={(e) => setPurpose(e.target.value)} />
        </label>

        <fieldset className="field">
          <legend>Agents in this channel</legend>
          <p className="field-hint">At least one. Each answers when @mentioned, and they can hand over to each other.</p>
          {agents.length === 0 && <p className="field-hint">This workspace has no agents yet — create one first.</p>}
          <div className="checks checks-column">
            {[...agents, ...members.filter((m) => !agents.some((a) => a.slug === m)).map((m) => ({ slug: m, name: `${m} (not found)`, emoji: "" }))].map((a) => (
              <label key={a.slug} className="check">
                <input
                  type="checkbox"
                  checked={members.includes(a.slug)}
                  onChange={(e) => setMembers(e.target.checked ? [...members, a.slug] : members.filter((m) => m !== a.slug))}
                />
                <span aria-hidden>{a.emoji}</span>
                {a.name}
                <span className="field-hint">@{a.slug}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="field">
          <span>Who answers when nobody is mentioned?</span>
          <select value={answering} disabled={members.length === 0} onChange={(e) => setResponder(e.target.value)}>
            <option value="">Nobody — a message has to @mention someone</option>
            {members.map((m) => (
              <option key={m} value={m}>
                {agents.find((a) => a.slug === m)?.name ?? m}
              </option>
            ))}
          </select>
        </label>

        {error && (
          <p className="panel-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
