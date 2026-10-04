import React, { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icon.jsx";
import { api } from "../lib/api.js";
import { accessModes } from "../lib/constants.js";
import { tap } from "../lib/haptic.js";

export const Composer = React.memo(function Composer({
  ready,
  run,
  accessIndex,
  selectedModel,
  selectedReasoning,
  value,
  onChange,
  onSend,
  onInterrupt,
  onCycleAccess,
  onOpenModels,
  onExpand,
  promptRef,
}) {
  const text = value;
  const setText = onChange;
  const [files, setFiles] = useState([]);
  const [skills, setSkills] = useState([]);
  const [skillQuery, setSkillQuery] = useState(null);
  const [skillIndex, setSkillIndex] = useState(0);
  const [listening, setListening] = useState(false);
  const fileRef = useRef(null);
  const skillsLoaded = useRef(false);
  const accessMode = accessModes[accessIndex];
  const modelLabel = selectedModel.replace(/^gpt-/i, "").toUpperCase();
  const running = ["running", "streaming", "approval", "interrupting"].includes(run.state);

  useEffect(() => {
    const el = promptRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value, promptRef]);

  const slashMatch = useMemo(() => {
    const caret = text.length;
    const match = text.slice(0, caret).match(/(^|\s)([/／])([\p{L}\p{N}:_-]*)$/u);
    if (!match) return null;
    return { start: caret - match[3].length - match[2].length, end: caret, query: match[3].toLowerCase() };
  }, [text]);

  useEffect(() => {
    setSkillQuery(slashMatch);
    setSkillIndex(0);
    if (slashMatch && !skillsLoaded.current) {
      skillsLoaded.current = true;
      api.skills().then((r) => setSkills(r.data || [])).catch(() => {});
    }
  }, [slashMatch]);

  const filteredSkills = useMemo(() => {
    if (!skillQuery) return [];
    const needle = skillQuery.query;
    return skills
      .filter((skill) =>
        `${skill.trigger || ""} ${skill.name || ""} ${skill.id || ""} ${skill.pluginName || ""} ${skill.description || ""}`
          .toLowerCase()
          .includes(needle),
      )
      .slice(0, 8);
  }, [skills, skillQuery]);

  const applySkill = (skill) => {
    if (!skillQuery) return;
    const command = skill.trigger || `/${skill.name || skill.id}`;
    setText(`${text.slice(0, skillQuery.start)}${command} `);
    setSkillQuery(null);
  };

  const submit = (event) => {
    event.preventDefault();
    if (!ready) return;
    if (skillQuery && filteredSkills.length) {
      applySkill(filteredSkills[skillIndex]);
      return;
    }
    if (!text.trim() && !files.length) return;
    tap();
    onSend({ text: text.trim(), files });
    setText("");
    setFiles([]);
  };

  const onKeyDown = (event) => {
    if (skillQuery && filteredSkills.length) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSkillIndex((i) => (i + 1) % filteredSkills.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSkillIndex((i) => (i - 1 + filteredSkills.length) % filteredSkills.length);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setSkillQuery(null);
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        applySkill(filteredSkills[skillIndex]);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit(event);
    }
  };

  const startVoice = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    const recognition = new SpeechRecognition();
    recognition.lang = document.documentElement.lang || "zh-CN";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    setListening(true);
    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript || "";
      if (transcript) setText((v) => `${v}${v ? "\n" : ""}${transcript}`);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognition.start();
  };

  const addFiles = async (list) => {
    const next = [];
    for (const file of list) {
      if (!file.type.startsWith("image/")) continue;
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      next.push({ name: file.name, dataUrl });
    }
    setFiles((current) => current.concat(next));
  };

  return (
    <form id="composer" className="composer glass-edge" onSubmit={submit}>
      <input
        ref={fileRef}
        id="fileInput"
        className="hidden sr-only"
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => {
          addFiles([...(e.target.files || [])]);
          e.target.value = "";
        }}
      />
      {files.length ? (
        <div id="attachments" className="attachments">
          {files.map((f, i) => (
            <span key={i} className="attachment-chip">
              {f.name}
            </span>
          ))}
        </div>
      ) : null}
      <textarea
        id="prompt"
        ref={promptRef}
        rows={1}
        placeholder="输入后续修改要求"
        aria-label="发消息给 Codex"
        enterKeyHint="send"
        inputMode="text"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {skillQuery ? (
        <div id="slashSkillMenu" className="slash-skill-menu" role="listbox" aria-label="已安装技能">
          {filteredSkills.length ? (
            filteredSkills.map((skill, index) => (
              <button
                key={skill.id || skill.trigger}
                type="button"
                className="slash-skill-row"
                role="option"
                aria-selected={index === skillIndex}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => applySkill(skill)}
              >
                <span className="slash-skill-command">{skill.trigger || `/${skill.name || skill.id}`}</span>
                <span className="slash-skill-copy">
                  <strong>{skill.name || skill.id}</strong>
                  <small>{skill.description || skill.pluginName || "installed skill"}</small>
                </span>
              </button>
            ))
          ) : (
            <div className="slash-skill-empty">{skills.length ? "没有匹配的技能" : "尚未安装技能"}</div>
          )}
        </div>
      ) : null}
      <div className="composer-footer">
        <div className="composer-left">
          <button type="button" className="ghost-button" id="addButton" aria-label="添加图片" onClick={() => fileRef.current?.click()}>
            <Icon name="add" size={22} />
          </button>
          <button type="button" className="ghost-button" id="expandPromptButton" title="放大输入框" aria-label="放大输入框" onClick={onExpand}>
            <Icon name="expand_content" size={20} />
          </button>
          <button type="button" className="access-button" id="accessButton" onClick={onCycleAccess}>
            <span className="access-label">{accessMode.label}</span>
            <Icon name="chevron_right" size={14} className="button-chevron-icon" />
          </button>
        </div>
        <div className="composer-right">
          <button type="button" id="modelButton" className="model-button" onClick={onOpenModels}>
            <span className="model-button-label">{`${modelLabel} ${selectedReasoning}`}</span>
            <Icon name="chevron_right" size={14} className="button-chevron-icon" />
          </button>
          <button type="button" className={`voice-button${listening ? " listening" : ""}`} id="voiceButton" title="语音输入" aria-label="语音输入" onClick={startVoice}>
            <Icon name="mic" size={22} />
          </button>
          {running ? (
            <button type="button" className="interrupt-button" id="interruptRun" title="中断当前任务" aria-label="中断当前任务" onClick={onInterrupt}>
              <span className="interrupt-icon" aria-hidden="true" />
              <span className="interrupt-label">中断</span>
            </button>
          ) : null}
          <button id="send" type="submit" className="send-button" title="发送" aria-label="发送">
            <Icon name="send" size={22} />
          </button>
        </div>
      </div>
    </form>
  );
});
