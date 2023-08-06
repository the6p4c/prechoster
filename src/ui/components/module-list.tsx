import React, { createRef, RefObject, PureComponent, useState, useRef, useEffect } from 'react';
import {
    Document,
    Module,
    ModuleId,
    AnyModule,
    JsonValue,
    NamedSends,
    MOD_OUTPUT,
    ChangeType,
} from '../../document';
import { AnimationController, Spring } from '../../uikit/frame-animation';
import { shouldReduceMotion } from '../../uikit/animation';
import { ModulePicker } from './module-picker';
import './module-list.less';
import { TextField } from '../../uikit/text-field';
import { EditIcon } from './icons';

type ModuleSelection = {
    selected: ModuleId | null;
    inputs: ModuleId[];
    namedInputs: Map<ModuleId, Set<string>>;
    sends: ModuleId[];
    namedSends: Map<ModuleId, Set<string>>;
};
const NONE_SELECTION: ModuleSelection = {
    selected: null,
    inputs: [],
    namedInputs: new Map(),
    sends: [],
    namedSends: new Map(),
};

interface ModuleListState {
    selection: ModuleSelection;
    focusedMove: ModuleId | null;
    moveDragging: ModDraggingState | null;
}

interface ModDraggingState {
    module: ModuleId;
    topOffset: number;
    pointerOffset: number;
    itemHeights: Map<ModuleId, number>;
    pointerCapture: [HTMLElement, number];
}

interface ListItemState {
    position: Spring;
    ref: RefObject<ModuleItem>;
    offsetTop: number;
    offsetHeight: number;
}

type ModuleMoveState = {
    focused: boolean;
    dragging: ModDraggingState | null;
};

export class ModuleList extends PureComponent<ModuleList.Props, ModuleListState> {
    state = {
        selection: NONE_SELECTION,
        focusedMove: null,
        moveDragging: null,
    };
    list = createRef<HTMLDivElement>();
    listItems = new Map<ModuleId, ListItemState>();
    listHeight = 0;
    animCtrl = new AnimationController();
    listItemResizeObserver = new ResizeObserver(() => this.layoutItems(true));

    select(mod: ModuleId | null) {
        if (!mod) {
            this.setState({ selection: NONE_SELECTION });
            return;
        }
        const module = this.props.document.findModule(mod);
        if (!module) {
            this.setState({ selection: NONE_SELECTION });
            return;
        }
        const sends = module.sends;
        const namedSends = module.namedSends;
        const { inputs, namedInputs: namedInputsRev } = this.props.document.findModuleInputIds(mod);

        const namedInputs = new Map();
        for (const [key, modId] of namedInputsRev) {
            if (!namedInputs.has(modId)) namedInputs.set(modId, new Set());
            namedInputs.get(modId)!.add(key);
        }

        this.setState({
            selection: {
                selected: mod,
                inputs,
                namedInputs,
                sends,
                namedSends,
            },
        });
    }

    componentDidMount() {
        this.props.document.addEventListener('change', this.onDocumentChange);
        this.select(this.props.selected);
    }

    componentDidUpdate(prevProps: ModuleList.Props) {
        if (this.props.document !== prevProps.document) {
            prevProps.document.removeEventListener('change', this.onDocumentChange);
            this.props.document.addEventListener('change', this.onDocumentChange);
        }
        if (this.props.selected !== prevProps.selected) {
            this.select(this.props.selected);

            if (this.props.selected) {
                const node = this.list.current!.querySelector(
                    `.module-item[data-id="${this.props.selected}"]`
                );
                if (node && node.scrollIntoView) {
                    node.scrollIntoView({
                        behavior: 'smooth',
                        block: 'nearest',
                    });
                }
            }
        }

        this.layoutItems();
    }

    componentWillUnmount() {
        this.props.document.removeEventListener('change', this.onDocumentChange);
        this.listItemResizeObserver.disconnect();
    }

    onDocumentChange = () => {
        this.layoutItems();
        this.forceUpdate();
    };

    layoutItems(didResize = false) {
        if (this.state.moveDragging) return;
        let shouldUpdate = false;
        let y = 0;

        const prevHeight = this.listHeight;
        this.listHeight = 0;

        for (const module of this.props.document.modules) {
            const item = this.listItems.get(module.id);
            if (!item) continue;
            const node = item.ref.current?.node?.current;
            if (node) this.listItemResizeObserver.observe(node);
            item.offsetTop = y;

            if (!item.offsetHeight || didResize) {
                item.offsetHeight = node?.offsetHeight || 0;
            }

            y += item.offsetHeight;
            item.position.target = item.offsetTop;
            this.listHeight += item.offsetHeight;

            shouldUpdate = shouldUpdate || item.position.value !== item.position.target;
        }

        shouldUpdate = shouldUpdate || this.listHeight !== prevHeight;

        if (shouldUpdate) this.animCtrl.add(this);
    }

    update(dt: number) {
        const reducedMotion = shouldReduceMotion();

        let isDone = true;
        for (const item of this.listItems.values()) {
            if (reducedMotion) item.position.value = item.position.target;
            isDone = item.position.update(dt) && isDone;
        }
        this.forceUpdate();
        return isDone;
    }

    onModuleMove = (module: AnyModule, i: number) => (action: string, data: any) => {
        const { document } = this.props;

        if (action === 'focus') {
            this.setState({ focusedMove: module.id });
        } else if (action === 'blur') {
            if (this.state.focusedMove === module.id) {
                this.setState({ focusedMove: null });
            }
        } else if (action === 'delta') {
            const delta: number = data;
            if (i + delta < 0) return;
            if (i + delta >= document.modules.length) return;

            const modules = document.modules.slice();
            const tmp = modules[i + delta];
            modules[i + delta] = module;
            modules[i] = tmp;

            const tmpTop = this.listItems.get(module.id)!.offsetTop;
            this.listItems.get(module.id)!.offsetTop = this.listItems.get(tmp.id)!.offsetTop;
            this.listItems.get(tmp.id)!.offsetTop = tmpTop;

            document.pushModulesState(modules, { type: ChangeType.RearrangeModules });
        } else if (action === 'dragStart') {
            const moduleItem = this.listItems.get(module.id)!;
            const moveButton = moduleItem.ref.current!.moveButton.current!;
            moveButton.setPointerCapture(data.pointerId);

            const moduleTop = moduleItem.offsetTop;
            let precedingHeight = 0;

            const modules = this.props.document.modules;
            let y = 0;
            const itemHeights = new Map<ModuleId, number>();
            for (let j = 0; j < modules.length; j++) {
                const m = modules[j];
                const li = this.listItems.get(m.id)!;
                const headerHeight = li.ref.current?.header?.current?.offsetHeight || 0;
                const borderHeight = 2;
                const totalHeight = headerHeight + borderHeight;

                if (j < i) precedingHeight += totalHeight;
                itemHeights.set(m.id, totalHeight);
            }
            const topOffset = moduleTop - precedingHeight;

            this.setState(
                {
                    moveDragging: {
                        module: module.id,
                        topOffset,
                        pointerOffset: moduleTop - data.clientY,
                        itemHeights,
                        pointerCapture: [moveButton, data.pointerId],
                    },
                },
                () => {
                    let y = topOffset;
                    for (let j = 0; j < modules.length; j++) {
                        const li = this.listItems.get(modules[j].id)!;
                        if (modules[j].id !== module.id) li.position.target = y;
                        y += itemHeights.get(modules[j].id)!;
                    }
                    this.animCtrl.add(this);
                }
            );
        } else if (action === 'maybeDragMove') {
            if (this.state.moveDragging) {
                const state = this.state.moveDragging as ModDraggingState;
                const modules = this.props.document.modules;

                const listPos = data.clientY + state.pointerOffset - state.topOffset;
                let insertionPos = 0;
                {
                    let y = 0;
                    for (let j = 0; j < modules.length; j++) {
                        const height = state.itemHeights.get(modules[j].id)!;
                        if (listPos < y + height / 2) {
                            insertionPos = j;
                            break;
                        }
                        y += height;
                    }
                }

                const newOrder = modules.map((m) => m.id);
                newOrder.splice(i, 1);
                newOrder.splice(insertionPos, 0, module.id);

                let y = state.topOffset;
                for (const id of newOrder) {
                    const li = this.listItems.get(id)!;
                    if (id !== module.id) li.position.target = y;
                    y += state.itemHeights.get(id)!;
                }

                this.listItems.get(module.id)!.position.target = data.clientY + state.pointerOffset;

                this.animCtrl.add(this);
            }
        } else if (action === 'dragEnd') {
            if (this.state.moveDragging) {
                const state = this.state.moveDragging as ModDraggingState;
                const modules = this.props.document.modules;

                const [moveButton, pointerId] = state.pointerCapture;
                moveButton.releasePointerCapture(pointerId);
                this.setState({ moveDragging: null }, () => {
                    this.animCtrl.add(this);
                });

                const listPos = data.clientY + state.pointerOffset - state.topOffset;
                let insertionPos = 0;
                {
                    let y = 0;
                    for (let j = 0; j < modules.length; j++) {
                        const height = state.itemHeights.get(modules[j].id)!;
                        if (listPos < y + height / 2) {
                            insertionPos = j;
                            break;
                        }
                        y += height;
                    }
                }

                if (insertionPos !== i) {
                    const newModules = modules.slice();
                    newModules.splice(i, 1);
                    newModules.splice(insertionPos, 0, module);
                    document.pushModulesState(newModules, { type: ChangeType.RearrangeModules });
                }
            }
        }
    };

    render() {
        const { document } = this.props;
        const knownModules = new Set();
        for (const mod of document.modules) {
            knownModules.add(mod.id);
            if (!this.listItems.has(mod.id)) {
                this.listItems.set(mod.id, {
                    position: new Spring({
                        value: NaN,
                        stiffness: 439,
                        damping: 42,
                    }),
                    ref: createRef(),
                    offsetTop: 0,
                    offsetHeight: 0,
                });
            }
        }
        for (const k of [...this.listItems.keys()]) {
            if (!knownModules.has(k)) this.listItems.delete(k);
        }

        return (
            <div className="module-list-container" aria-label="Modules">
                <div className="module-list" ref={this.list} role="list">
                    <div style={{ height: this.listHeight }} className="module-list-height" />
                    {document.modules.map((module, i) => (
                        <ModuleItem
                            key={module.id}
                            ref={this.listItems.get(module.id)!.ref}
                            index={i}
                            selection={this.state.selection}
                            document={document}
                            module={module}
                            onSelect={() => this.props.onSelect(module.id)}
                            onChange={(m) => {
                                document.insertModule(m);
                            }}
                            onMove={this.onModuleMove(module, i)}
                            state={this.listItems.get(module.id)!}
                            moveState={{
                                focused: this.state.focusedMove === module.id,
                                dragging: this.state.moveDragging,
                            }}
                            onRemove={() => document.removeModule(module.id)}
                        />
                    ))}
                    <AddModule
                        onAdd={(module) => {
                            document.insertModule(module);
                        }}
                    />
                </div>
            </div>
        );
    }
}

namespace ModuleList {
    export interface Props {
        document: Document;
        selected: ModuleId | null;
        onSelect: (m: ModuleId | null) => void;
    }
}

function AddModule({ onAdd }: { onAdd: (m: AnyModule) => void }) {
    const [open, setOpen] = useState(false);
    const button = useRef<HTMLElement>();

    return (
        <div className="add-module">
            <button ref={button as any} onClick={() => setOpen(true)} aria-label="add module" />
            <ModulePicker
                anchor={button.current}
                open={open}
                onClose={() => setOpen(false)}
                onPick={(plugin) => {
                    onAdd(new Module(plugin));
                    setOpen(false);
                }}
            />
        </div>
    );
}

class ModuleItem extends PureComponent<ModuleItem.Props> {
    state = {
        collapsed: false,
    };
    node = createRef<HTMLDivElement>();
    header = createRef<HTMLDivElement>();
    moveButton = createRef<HTMLButtonElement>();
    nodeId = Math.random().toString(36);
    labelNodeId = Math.random().toString(36);

    componentDidUpdate() {
        if (this.props.moveState.focused) {
            this.moveButton.current?.focus();
            this.moveButton.current?.scrollIntoView({
                behavior: 'smooth',
                block: 'nearest',
                inline: 'nearest',
            });
        }
    }

    render() {
        const {
            document,
            index,
            module,
            onSelect,
            onChange,
            onMove,
            moveState,
            onRemove,
            selection,
        } = this.props;
        const Editor = module.plugin.component as any; // typescript is yelling at me :(

        let className = 'module-item';
        if (selection.selected === module.id) className += ' is-selected';
        if (selection.inputs.includes(module.id)) className += ' is-sending-to-selected';
        if (selection.sends.includes(module.id)) className += ' is-receiving-selected';
        if (moveState.dragging?.module === module.id) className += ' is-being-dragged';
        if (this.state.collapsed || moveState.dragging) className += ' is-collapsed';

        const onMoveKeyDown = (e: React.KeyboardEvent) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
                e.preventDefault();
                onMove('delta', -1);
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
                e.preventDefault();
                onMove('delta', 1);
            }
        };

        const top = this.props.state.offsetTop;
        let transform = '';
        const offsetLoc = this.props.state.position.value - top;
        if (Math.abs(offsetLoc) > 0.5) {
            transform = `translateY(${offsetLoc}px)`;
        }

        return (
            <div
                id={this.nodeId}
                role="listitem"
                aria-labelledby={this.labelNodeId}
                className={className}
                onPointerDown={onSelect}
                data-id={module.id}
                style={{ top, transform }}
                ref={this.node}
            >
                <div className="i-header" ref={this.header} role="group" aria-label="header">
                    <div className="i-title">
                        <button
                            className="i-remove"
                            onClick={onRemove}
                            aria-label="remove this module"
                        />
                        <span className="i-label" id={this.labelNodeId}>
                            <span className="i-index">{index + 1}</span>
                            <ModuleTitle module={module} onChange={onChange} />
                        </span>
                    </div>
                    <div className="i-header-controls">
                        <button
                            className="i-drag-button"
                            ref={this.moveButton}
                            aria-label="move this module"
                            role="slider"
                            aria-valuemin={1}
                            aria-valuenow={index + 1}
                            aria-valuemax={document.modules.length}
                            aria-valuetext={`${index + 1}${
                                [null, 'st', 'nd', 'rd'][(index + 1) % 10] || 'th'
                            }`}
                            onFocus={() => onMove('focus', null)}
                            onBlur={() => onMove('blur', null)}
                            onKeyDown={onMoveKeyDown}
                            onTouchStart={(e) => {
                                e.preventDefault();
                            }}
                            onPointerDown={(e) => {
                                e.preventDefault();
                                onMove('dragStart', e);
                            }}
                            onPointerMove={(e) => {
                                e.preventDefault();
                                onMove('maybeDragMove', e);
                            }}
                            onPointerUp={(e) => {
                                e.preventDefault();
                                onMove('dragEnd', e);
                            }}
                        >
                            <span className="i-drag-icon">
                                <span className="i-line"></span>
                                <span className="i-line"></span>
                                <span className="i-line"></span>
                            </span>
                        </button>
                        <button
                            className="i-collapse-button"
                            aria-expanded={!this.state.collapsed}
                            aria-controls={this.nodeId}
                            aria-label="show contents"
                            onClick={() => this.setState({ collapsed: !this.state.collapsed })}
                        >
                            {this.state.collapsed ? '▶' : '▼'}
                        </button>
                    </div>
                </div>
                <div className="i-editor">
                    <Editor
                        document={document}
                        id={module.id}
                        data={module.data}
                        namedInputKeys={
                            new Set(document.findModuleInputIds(module.id).namedInputs.keys())
                        }
                        onChange={(data: JsonValue) => {
                            const mod = module.shallowClone();
                            mod.data = data;
                            onChange(mod);
                        }}
                    />
                </div>
                <div className="i-footer" role="group" aria-label="Connections">
                    <ModuleSends
                        document={document}
                        sends={module.sends}
                        onChange={(sends) => {
                            const newModule = module.shallowClone();
                            newModule.sends = sends;
                            onChange(newModule);
                        }}
                    />
                    <ModuleNamedSends
                        document={document}
                        namedSends={module.namedSends}
                        onChange={(namedSends) => {
                            const newModule = module.shallowClone();
                            newModule.namedSends = namedSends;
                            onChange(newModule);
                        }}
                    />
                </div>
            </div>
        );
    }
}

namespace ModuleItem {
    export interface Props {
        document: Document;
        index: number;
        module: AnyModule;
        onSelect: () => void;
        onChange: (m: AnyModule) => void;
        onMove: (action: string, data: any) => void;
        state: ListItemState;
        moveState: ModuleMoveState;
        onRemove: () => void;
        selection: ModuleSelection;
    }
}

function ModuleTitle({
    module,
    onChange,
}: {
    module: AnyModule;
    onChange: (m: AnyModule) => void;
}) {
    const [editing, setEditing] = useState(false);
    const description = module.plugin.description(module.data);

    const textField = useRef<TextField>(null);
    useEffect(() => {
        if (textField.current) {
            textField.current.focus();
            textField.current.input.current?.select();
        }
    }, [textField.current]);

    if (editing) {
        return (
            <TextField
                ref={textField}
                className="i-title is-editing"
                placeholder={description}
                value={module.title}
                onChange={(title) => {
                    const m = module.shallowClone();
                    m.title = title;
                    onChange(m);
                }}
                onKeyDown={(e) => {
                    if (e.key === 'Escape' || e.key === 'Enter') e.currentTarget.blur();
                }}
                onBlur={() => {
                    if (module.title.trim() !== module.title) {
                        const m = module.shallowClone();
                        m.title = m.title.trim();
                        onChange(m);
                    }
                    setEditing(false);
                }}
            />
        );
    }

    if (module.title) {
        return (
            <div className="i-title has-custom is-static">
                <div className="i-display-title" onClick={() => setEditing(true)}>
                    {module.title}
                    <button className="i-edit-icon" aria-label="edit name">
                        <EditIcon />
                    </button>
                </div>
                <div className="i-description">{description}</div>
            </div>
        );
    }

    return (
        <div className="i-title is-static">
            <div className="i-display-title" onClick={() => setEditing(true)}>
                {description}
                <button className="i-edit-icon" aria-label="edit name">
                    <EditIcon />
                </button>
            </div>
        </div>
    );
}

function ModuleSends({ document, sends, onChange }: ModuleSends.Props) {
    const makeModuleSelect = (
        key: string,
        value: ModuleId | null,
        onChange: (v: ModuleId) => void
    ) => {
        return (
            <select
                className="send-target"
                key={key}
                value={value || ''}
                onChange={(e) => onChange((e.target as HTMLSelectElement).value)}
            >
                <option value="" aria-label="nothing">
                    —
                </option>
                {document.modules
                    .map((mod, i) => {
                        if (!mod.plugin.acceptsInputs) return null;

                        const label = `${i + 1}. ${mod.plugin.description(mod.data)}`;
                        return (
                            <option key={i} value={mod.id}>
                                {label}
                            </option>
                        );
                    })
                    .filter((x) => x)}
                <option value={MOD_OUTPUT}>output</option>
            </select>
        );
    };

    return (
        <div className="i-sends">
            <div className="i-label">Send to</div>
            <ul className="i-list">
                {sends.map((target, i) => (
                    <li key={i} className="i-send-target">
                        {makeModuleSelect(i.toString(), target, (newTarget) => {
                            const newSends = sends.slice();
                            if (newTarget) newSends[i] = newTarget;
                            else newSends.splice(i, 1);
                            onChange(newSends);
                        })}
                    </li>
                ))}
                <li className="i-send-target is-new-target">
                    {makeModuleSelect(
                        (sends.length + 1).toString(),
                        null,
                        (newTarget) => newTarget && onChange(sends.concat([newTarget]))
                    )}
                </li>
            </ul>
        </div>
    );
}

namespace ModuleSends {
    export interface Props {
        document: Document;
        sends: ModuleId[];
        onChange: (v: ModuleId[]) => void;
    }
}

function ModuleNamedSends({ document, namedSends, onChange }: ModuleNamedSends.Props) {
    const makeModuleSelect = (
        key: string,
        value: ModuleId | null,
        onChange: (v: ModuleId) => void
    ) => {
        return (
            <select
                className="send-target"
                key={key}
                value={value || ''}
                onChange={(e) => onChange((e.target as HTMLSelectElement).value)}
            >
                <option value="" aria-label="nothing">
                    —
                </option>
                {document.modules
                    .map((mod, i) => {
                        if (!mod.plugin.acceptsNamedInputs) return null;

                        const label = `${i + 1}. ${mod.plugin.description(mod.data)}`;
                        return (
                            <option key={i} value={mod.id}>
                                {label}
                            </option>
                        );
                    })
                    .filter((x) => x)}
            </select>
        );
    };

    // FIXME: this is super hacky and bad
    return (
        <div className="i-sends">
            <div className="i-label">Provide to</div>
            <ul className="i-list">
                {[...namedSends.keys()].map((target, i) => (
                    <li key={i} className="i-send-target">
                        {makeModuleSelect(i.toString(), target, (newTarget) => {
                            const newSends = new Map(namedSends);
                            if (newTarget) {
                                const value = newSends.get(target)!;
                                newSends.set(newTarget, value);
                            }
                            newSends.delete(target);
                            onChange(newSends);
                        })}
                        {' as '}
                        <input
                            value={[...namedSends.get(target)!][0]}
                            onChange={(e) => {
                                const input = e.target as HTMLInputElement;
                                const newSends = new Map(namedSends);
                                newSends.set(target, new Set([input.value]));
                                onChange(newSends);
                            }}
                        />
                    </li>
                ))}
                <li className="i-send-target is-new-target">
                    {makeModuleSelect((namedSends.size + 1).toString(), null, (newTarget) => {
                        if (newTarget) {
                            const newSends = new Map(namedSends);
                            newSends.set(newTarget, new Set());
                            onChange(newSends);
                        }
                    })}
                </li>
            </ul>
        </div>
    );
}

namespace ModuleNamedSends {
    export interface Props {
        document: Document;
        namedSends: NamedSends;
        onChange: (v: NamedSends) => void;
    }
}
