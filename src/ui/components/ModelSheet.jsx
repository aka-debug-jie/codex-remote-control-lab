import React from "react";
import { BottomSheet } from "./BottomSheet.jsx";
import { Icon } from "./Icon.jsx";
import { modelChoices, reasoningLevels, reasoningEffortValue } from "../lib/constants.js";

export function ModelSheet({ open, onClose, selectedModel, selectedReasoning, onReasoning, onModel, onMore }) {
  return (
    <BottomSheet open={open} onClose={onClose} title="模型与推理强度" labelledBy="modelSheetTitle">
      <div className="section-title">推理强度</div>
      <div className="segmented" role="radiogroup" aria-label="推理强度">
        {reasoningLevels.map((level) => (
          <button
            key={level}
            type="button"
            className={level === selectedReasoning ? "active" : ""}
            role="radio"
            aria-checked={level === selectedReasoning}
            onClick={() => onReasoning(level)}
          >
            {level}
          </button>
        ))}
      </div>
      <div className="section-title" style={{ marginTop: 16 }}>
        模型
      </div>
      <div role="radiogroup" aria-label="模型">
        {modelChoices.map((model) => (
          <button
            key={model.id}
            type="button"
            className={`list-row${model.id === selectedModel ? " active" : ""}`}
            role="radio"
            aria-checked={model.id === selectedModel}
            onClick={() => onModel(model.id)}
          >
            <span className="list-row-icon"><Icon name="smart_toy" size={20} /></span>
            <span className="list-row-copy">
              <strong>{model.label}</strong>
              <small>{reasoningEffortValue(selectedReasoning) || "默认推理"}</small>
            </span>
            {model.id === selectedModel ? <span className="checkmark">✓</span> : null}
          </button>
        ))}
        <button type="button" className="list-row" id="moreModelsButton" role="menuitem" onClick={onMore}>
          <span className="list-row-icon"><Icon name="extension" size={20} /></span>
          <span className="list-row-copy">
            <strong>更多模型</strong>
            <small>查看完整模型目录</small>
          </span>
          <Icon name="chevron_right" size={20} />
        </button>
      </div>
    </BottomSheet>
  );
}
