var app = (function () {
    'use strict';

    function noop() { }
    function assign(tar, src) {
        // @ts-ignore
        for (const k in src)
            tar[k] = src[k];
        return tar;
    }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }
    function is_empty(obj) {
        return Object.keys(obj).length === 0;
    }
    function subscribe(store, ...callbacks) {
        if (store == null) {
            return noop;
        }
        const unsub = store.subscribe(...callbacks);
        return unsub.unsubscribe ? () => unsub.unsubscribe() : unsub;
    }
    function component_subscribe(component, store, callback) {
        component.$$.on_destroy.push(subscribe(store, callback));
    }
    function create_slot(definition, ctx, $$scope, fn) {
        if (definition) {
            const slot_ctx = get_slot_context(definition, ctx, $$scope, fn);
            return definition[0](slot_ctx);
        }
    }
    function get_slot_context(definition, ctx, $$scope, fn) {
        return definition[1] && fn
            ? assign($$scope.ctx.slice(), definition[1](fn(ctx)))
            : $$scope.ctx;
    }
    function get_slot_changes(definition, $$scope, dirty, fn) {
        if (definition[2] && fn) {
            const lets = definition[2](fn(dirty));
            if ($$scope.dirty === undefined) {
                return lets;
            }
            if (typeof lets === 'object') {
                const merged = [];
                const len = Math.max($$scope.dirty.length, lets.length);
                for (let i = 0; i < len; i += 1) {
                    merged[i] = $$scope.dirty[i] | lets[i];
                }
                return merged;
            }
            return $$scope.dirty | lets;
        }
        return $$scope.dirty;
    }
    function update_slot(slot, slot_definition, ctx, $$scope, dirty, get_slot_changes_fn, get_slot_context_fn) {
        const slot_changes = get_slot_changes(slot_definition, $$scope, dirty, get_slot_changes_fn);
        if (slot_changes) {
            const slot_context = get_slot_context(slot_definition, ctx, $$scope, get_slot_context_fn);
            slot.p(slot_context, slot_changes);
        }
    }
    function exclude_internal_props(props) {
        const result = {};
        for (const k in props)
            if (k[0] !== '$')
                result[k] = props[k];
        return result;
    }
    function action_destroyer(action_result) {
        return action_result && is_function(action_result.destroy) ? action_result.destroy : noop;
    }

    function append(target, node) {
        target.appendChild(node);
    }
    function insert(target, node, anchor) {
        target.insertBefore(node, anchor || null);
    }
    function detach(node) {
        node.parentNode.removeChild(node);
    }
    function element(name) {
        return document.createElement(name);
    }
    function svg_element(name) {
        return document.createElementNS('http://www.w3.org/2000/svg', name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
    }
    function empty() {
        return text('');
    }
    function listen(node, event, handler, options) {
        node.addEventListener(event, handler, options);
        return () => node.removeEventListener(event, handler, options);
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function set_attributes(node, attributes) {
        // @ts-ignore
        const descriptors = Object.getOwnPropertyDescriptors(node.__proto__);
        for (const key in attributes) {
            if (attributes[key] == null) {
                node.removeAttribute(key);
            }
            else if (key === 'style') {
                node.style.cssText = attributes[key];
            }
            else if (key === '__value') {
                node.value = node[key] = attributes[key];
            }
            else if (descriptors[key] && descriptors[key].set) {
                node[key] = attributes[key];
            }
            else {
                attr(node, key, attributes[key]);
            }
        }
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function set_data(text, data) {
        data = '' + data;
        if (text.wholeText !== data)
            text.data = data;
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }
    function get_current_component() {
        if (!current_component)
            throw new Error(`Function called outside component initialization`);
        return current_component;
    }
    function onMount(fn) {
        get_current_component().$$.on_mount.push(fn);
    }
    function onDestroy(fn) {
        get_current_component().$$.on_destroy.push(fn);
    }
    function setContext(key, context) {
        get_current_component().$$.context.set(key, context);
    }
    function getContext(key) {
        return get_current_component().$$.context.get(key);
    }
    // TODO figure out if we still want to support
    // shorthand events, or if we want to implement
    // a real bubbling mechanism
    function bubble(component, event) {
        const callbacks = component.$$.callbacks[event.type];
        if (callbacks) {
            callbacks.slice().forEach(fn => fn(event));
        }
    }

    const dirty_components = [];
    const binding_callbacks = [];
    const render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    function add_flush_callback(fn) {
        flush_callbacks.push(fn);
    }
    let flushing = false;
    const seen_callbacks = new Set();
    function flush() {
        if (flushing)
            return;
        flushing = true;
        do {
            // first, call beforeUpdate functions
            // and update components
            for (let i = 0; i < dirty_components.length; i += 1) {
                const component = dirty_components[i];
                set_current_component(component);
                update(component.$$);
            }
            dirty_components.length = 0;
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                    callback();
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
        flushing = false;
        seen_callbacks.clear();
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            const dirty = $$.dirty;
            $$.dirty = [-1];
            $$.fragment && $$.fragment.p($$.ctx, dirty);
            $$.after_update.forEach(add_render_callback);
        }
    }
    const outroing = new Set();
    let outros;
    function group_outros() {
        outros = {
            r: 0,
            c: [],
            p: outros // parent group
        };
    }
    function check_outros() {
        if (!outros.r) {
            run_all(outros.c);
        }
        outros = outros.p;
    }
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function transition_out(block, local, detach, callback) {
        if (block && block.o) {
            if (outroing.has(block))
                return;
            outroing.add(block);
            outros.c.push(() => {
                outroing.delete(block);
                if (callback) {
                    if (detach)
                        block.d(1);
                    callback();
                }
            });
            block.o(local);
        }
    }
    function outro_and_destroy_block(block, lookup) {
        transition_out(block, 1, 1, () => {
            lookup.delete(block.key);
        });
    }
    function update_keyed_each(old_blocks, dirty, get_key, dynamic, ctx, list, lookup, node, destroy, create_each_block, next, get_context) {
        let o = old_blocks.length;
        let n = list.length;
        let i = o;
        const old_indexes = {};
        while (i--)
            old_indexes[old_blocks[i].key] = i;
        const new_blocks = [];
        const new_lookup = new Map();
        const deltas = new Map();
        i = n;
        while (i--) {
            const child_ctx = get_context(ctx, list, i);
            const key = get_key(child_ctx);
            let block = lookup.get(key);
            if (!block) {
                block = create_each_block(key, child_ctx);
                block.c();
            }
            else if (dynamic) {
                block.p(child_ctx, dirty);
            }
            new_lookup.set(key, new_blocks[i] = block);
            if (key in old_indexes)
                deltas.set(key, Math.abs(i - old_indexes[key]));
        }
        const will_move = new Set();
        const did_move = new Set();
        function insert(block) {
            transition_in(block, 1);
            block.m(node, next);
            lookup.set(block.key, block);
            next = block.first;
            n--;
        }
        while (o && n) {
            const new_block = new_blocks[n - 1];
            const old_block = old_blocks[o - 1];
            const new_key = new_block.key;
            const old_key = old_block.key;
            if (new_block === old_block) {
                // do nothing
                next = new_block.first;
                o--;
                n--;
            }
            else if (!new_lookup.has(old_key)) {
                // remove old block
                destroy(old_block, lookup);
                o--;
            }
            else if (!lookup.has(new_key) || will_move.has(new_key)) {
                insert(new_block);
            }
            else if (did_move.has(old_key)) {
                o--;
            }
            else if (deltas.get(new_key) > deltas.get(old_key)) {
                did_move.add(new_key);
                insert(new_block);
            }
            else {
                will_move.add(old_key);
                o--;
            }
        }
        while (o--) {
            const old_block = old_blocks[o];
            if (!new_lookup.has(old_block.key))
                destroy(old_block, lookup);
        }
        while (n)
            insert(new_blocks[n - 1]);
        return new_blocks;
    }

    function get_spread_update(levels, updates) {
        const update = {};
        const to_null_out = {};
        const accounted_for = { $$scope: 1 };
        let i = levels.length;
        while (i--) {
            const o = levels[i];
            const n = updates[i];
            if (n) {
                for (const key in o) {
                    if (!(key in n))
                        to_null_out[key] = 1;
                }
                for (const key in n) {
                    if (!accounted_for[key]) {
                        update[key] = n[key];
                        accounted_for[key] = 1;
                    }
                }
                levels[i] = n;
            }
            else {
                for (const key in o) {
                    accounted_for[key] = 1;
                }
            }
        }
        for (const key in to_null_out) {
            if (!(key in update))
                update[key] = undefined;
        }
        return update;
    }
    function get_spread_object(spread_props) {
        return typeof spread_props === 'object' && spread_props !== null ? spread_props : {};
    }

    function bind(component, name, callback) {
        const index = component.$$.props[name];
        if (index !== undefined) {
            component.$$.bound[index] = callback;
            callback(component.$$.ctx[index]);
        }
    }
    function create_component(block) {
        block && block.c();
    }
    function mount_component(component, target, anchor) {
        const { fragment, on_mount, on_destroy, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        // onMount happens before the initial afterUpdate
        add_render_callback(() => {
            const new_on_destroy = on_mount.map(run).filter(is_function);
            if (on_destroy) {
                on_destroy.push(...new_on_destroy);
            }
            else {
                // Edge case - component was destroyed immediately,
                // most likely as a result of a binding initialising
                run_all(new_on_destroy);
            }
            component.$$.on_mount = [];
        });
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const prop_values = options.props || {};
        const $$ = component.$$ = {
            fragment: null,
            ctx: null,
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            before_update: [],
            after_update: [],
            context: new Map(parent_component ? parent_component.$$.context : []),
            // everything else
            callbacks: blank_object(),
            dirty,
            skip_bound: false
        };
        let ready = false;
        $$.ctx = instance
            ? instance(component, prop_values, (i, ret, ...rest) => {
                const value = rest.length ? rest[0] : ret;
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if (!$$.skip_bound && $$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                const nodes = children(options.target);
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(nodes);
                nodes.forEach(detach);
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor);
            flush();
        }
        set_current_component(parent_component);
    }
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set($$props) {
            if (this.$$set && !is_empty($$props)) {
                this.$$.skip_bound = true;
                this.$$set($$props);
                this.$$.skip_bound = false;
            }
        }
    }

    function forwardEventsBuilder(component, additionalEvents = []) {
      const events = [
        'focus', 'blur',
        'fullscreenchange', 'fullscreenerror', 'scroll',
        'cut', 'copy', 'paste',
        'keydown', 'keypress', 'keyup',
        'auxclick', 'click', 'contextmenu', 'dblclick', 'mousedown', 'mouseenter', 'mouseleave', 'mousemove', 'mouseover', 'mouseout', 'mouseup', 'pointerlockchange', 'pointerlockerror', 'select', 'wheel',
        'drag', 'dragend', 'dragenter', 'dragstart', 'dragleave', 'dragover', 'drop',
        'touchcancel', 'touchend', 'touchmove', 'touchstart',
        'pointerover', 'pointerenter', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'pointerout', 'pointerleave', 'gotpointercapture', 'lostpointercapture',
        ...additionalEvents
      ];

      function forward(e) {
        bubble(component, e);
      }

      return node => {
        const destructors = [];

        for (let i = 0; i < events.length; i++) {
          destructors.push(listen(node, events[i], forward));
        }

        return {
          destroy: () => {
            for (let i = 0; i < destructors.length; i++) {
              destructors[i]();
            }
          }
        }
      };
    }

    function exclude(obj, keys) {
      let names = Object.getOwnPropertyNames(obj);
      const newObj = {};

      for (let i = 0; i < names.length; i++) {
        const name = names[i];
        const cashIndex = name.indexOf('$');
        if (cashIndex !== -1 && keys.indexOf(name.substring(0, cashIndex + 1)) !== -1) {
          continue;
        }
        if (keys.indexOf(name) !== -1) {
          continue;
        }
        newObj[name] = obj[name];
      }

      return newObj;
    }

    function useActions(node, actions) {
      let objects = [];

      if (actions) {
        for (let i = 0; i < actions.length; i++) {
          const isArray = Array.isArray(actions[i]);
          const action = isArray ? actions[i][0] : actions[i];
          if (isArray && actions[i].length > 1) {
            objects.push(action(node, actions[i][1]));
          } else {
            objects.push(action(node));
          }
        }
      }

      return {
        update(actions) {
          if ((actions && actions.length || 0) != objects.length) {
            throw new Error('You must not change the length of an actions array.');
          }

          if (actions) {
            for (let i = 0; i < actions.length; i++) {
              if (objects[i] && 'update' in objects[i]) {
                const isArray = Array.isArray(actions[i]);
                if (isArray && actions[i].length > 1) {
                  objects[i].update(actions[i][1]);
                } else {
                  objects[i].update();
                }
              }
            }
          }
        },

        destroy() {
          for (let i = 0; i < objects.length; i++) {
            if (objects[i] && 'destroy' in objects[i]) {
              objects[i].destroy();
            }
          }
        }
      }
    }

    /* node_modules\@smui\card\Card.svelte generated by Svelte v3.24.1 */

    function create_fragment(ctx) {
    	let div;
    	let div_class_value;
    	let useActions_action;
    	let forwardEvents_action;
    	let current;
    	let mounted;
    	let dispose;
    	const default_slot_template = /*$$slots*/ ctx[7].default;
    	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[6], null);

    	let div_levels = [
    		{
    			class: div_class_value = "\n    mdc-card\n    " + /*className*/ ctx[1] + "\n    " + (/*variant*/ ctx[2] === "outlined"
    			? "mdc-card--outlined"
    			: "") + "\n    " + (/*padded*/ ctx[3] ? "smui-card--padded" : "") + "\n  "
    		},
    		exclude(/*$$props*/ ctx[5], ["use", "class", "variant", "padded"])
    	];

    	let div_data = {};

    	for (let i = 0; i < div_levels.length; i += 1) {
    		div_data = assign(div_data, div_levels[i]);
    	}

    	return {
    		c() {
    			div = element("div");
    			if (default_slot) default_slot.c();
    			set_attributes(div, div_data);
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);

    			if (default_slot) {
    				default_slot.m(div, null);
    			}

    			current = true;

    			if (!mounted) {
    				dispose = [
    					action_destroyer(useActions_action = useActions.call(null, div, /*use*/ ctx[0])),
    					action_destroyer(forwardEvents_action = /*forwardEvents*/ ctx[4].call(null, div))
    				];

    				mounted = true;
    			}
    		},
    		p(ctx, [dirty]) {
    			if (default_slot) {
    				if (default_slot.p && dirty & /*$$scope*/ 64) {
    					update_slot(default_slot, default_slot_template, ctx, /*$$scope*/ ctx[6], dirty, null, null);
    				}
    			}

    			set_attributes(div, div_data = get_spread_update(div_levels, [
    				(!current || dirty & /*className, variant, padded*/ 14 && div_class_value !== (div_class_value = "\n    mdc-card\n    " + /*className*/ ctx[1] + "\n    " + (/*variant*/ ctx[2] === "outlined"
    				? "mdc-card--outlined"
    				: "") + "\n    " + (/*padded*/ ctx[3] ? "smui-card--padded" : "") + "\n  ")) && { class: div_class_value },
    				dirty & /*$$props*/ 32 && exclude(/*$$props*/ ctx[5], ["use", "class", "variant", "padded"])
    			]));

    			if (useActions_action && is_function(useActions_action.update) && dirty & /*use*/ 1) useActions_action.update.call(null, /*use*/ ctx[0]);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(default_slot, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(default_slot, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    			if (default_slot) default_slot.d(detaching);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    function instance($$self, $$props, $$invalidate) {
    	const forwardEvents = forwardEventsBuilder(get_current_component());
    	let { use = [] } = $$props;
    	let { class: className = "" } = $$props;
    	let { variant = "raised" } = $$props;
    	let { padded = false } = $$props;
    	let { $$slots = {}, $$scope } = $$props;

    	$$self.$$set = $$new_props => {
    		$$invalidate(5, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
    		if ("use" in $$new_props) $$invalidate(0, use = $$new_props.use);
    		if ("class" in $$new_props) $$invalidate(1, className = $$new_props.class);
    		if ("variant" in $$new_props) $$invalidate(2, variant = $$new_props.variant);
    		if ("padded" in $$new_props) $$invalidate(3, padded = $$new_props.padded);
    		if ("$$scope" in $$new_props) $$invalidate(6, $$scope = $$new_props.$$scope);
    	};

    	$$props = exclude_internal_props($$props);
    	return [use, className, variant, padded, forwardEvents, $$props, $$scope, $$slots];
    }

    class Card extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance, create_fragment, safe_not_equal, { use: 0, class: 1, variant: 2, padded: 3 });
    	}
    }

    /**
     * Stores result from supportsCssVariables to avoid redundant processing to
     * detect CSS custom variable support.
     */
    var supportsCssVariables_;
    function detectEdgePseudoVarBug(windowObj) {
        // Detect versions of Edge with buggy var() support
        // See: https://developer.microsoft.com/en-us/microsoft-edge/platform/issues/11495448/
        var document = windowObj.document;
        var node = document.createElement('div');
        node.className = 'mdc-ripple-surface--test-edge-var-bug';
        // Append to head instead of body because this script might be invoked in the
        // head, in which case the body doesn't exist yet. The probe works either way.
        document.head.appendChild(node);
        // The bug exists if ::before style ends up propagating to the parent element.
        // Additionally, getComputedStyle returns null in iframes with display: "none" in Firefox,
        // but Firefox is known to support CSS custom properties correctly.
        // See: https://bugzilla.mozilla.org/show_bug.cgi?id=548397
        var computedStyle = windowObj.getComputedStyle(node);
        var hasPseudoVarBug = computedStyle !== null && computedStyle.borderTopStyle === 'solid';
        if (node.parentNode) {
            node.parentNode.removeChild(node);
        }
        return hasPseudoVarBug;
    }
    function supportsCssVariables(windowObj, forceRefresh) {
        if (forceRefresh === void 0) { forceRefresh = false; }
        var CSS = windowObj.CSS;
        var supportsCssVars = supportsCssVariables_;
        if (typeof supportsCssVariables_ === 'boolean' && !forceRefresh) {
            return supportsCssVariables_;
        }
        var supportsFunctionPresent = CSS && typeof CSS.supports === 'function';
        if (!supportsFunctionPresent) {
            return false;
        }
        var explicitlySupportsCssVars = CSS.supports('--css-vars', 'yes');
        // See: https://bugs.webkit.org/show_bug.cgi?id=154669
        // See: README section on Safari
        var weAreFeatureDetectingSafari10plus = (CSS.supports('(--css-vars: yes)') &&
            CSS.supports('color', '#00000000'));
        if (explicitlySupportsCssVars || weAreFeatureDetectingSafari10plus) {
            supportsCssVars = !detectEdgePseudoVarBug(windowObj);
        }
        else {
            supportsCssVars = false;
        }
        if (!forceRefresh) {
            supportsCssVariables_ = supportsCssVars;
        }
        return supportsCssVars;
    }
    function getNormalizedEventCoords(evt, pageOffset, clientRect) {
        if (!evt) {
            return { x: 0, y: 0 };
        }
        var x = pageOffset.x, y = pageOffset.y;
        var documentX = x + clientRect.left;
        var documentY = y + clientRect.top;
        var normalizedX;
        var normalizedY;
        // Determine touch point relative to the ripple container.
        if (evt.type === 'touchstart') {
            var touchEvent = evt;
            normalizedX = touchEvent.changedTouches[0].pageX - documentX;
            normalizedY = touchEvent.changedTouches[0].pageY - documentY;
        }
        else {
            var mouseEvent = evt;
            normalizedX = mouseEvent.pageX - documentX;
            normalizedY = mouseEvent.pageY - documentY;
        }
        return { x: normalizedX, y: normalizedY };
    }

    /*! *****************************************************************************
    Copyright (c) Microsoft Corporation.

    Permission to use, copy, modify, and/or distribute this software for any
    purpose with or without fee is hereby granted.

    THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
    REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
    AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
    INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
    LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
    OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
    PERFORMANCE OF THIS SOFTWARE.
    ***************************************************************************** */
    /* global Reflect, Promise */

    var extendStatics = function(d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };

    function __extends(d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    }

    var __assign = function() {
        __assign = Object.assign || function __assign(t) {
            for (var s, i = 1, n = arguments.length; i < n; i++) {
                s = arguments[i];
                for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p)) t[p] = s[p];
            }
            return t;
        };
        return __assign.apply(this, arguments);
    };

    function __read(o, n) {
        var m = typeof Symbol === "function" && o[Symbol.iterator];
        if (!m) return o;
        var i = m.call(o), r, ar = [], e;
        try {
            while ((n === void 0 || n-- > 0) && !(r = i.next()).done) ar.push(r.value);
        }
        catch (error) { e = { error: error }; }
        finally {
            try {
                if (r && !r.done && (m = i["return"])) m.call(i);
            }
            finally { if (e) throw e.error; }
        }
        return ar;
    }

    function __spread() {
        for (var ar = [], i = 0; i < arguments.length; i++)
            ar = ar.concat(__read(arguments[i]));
        return ar;
    }

    /**
     * @license
     * Copyright 2016 Google Inc.
     *
     * Permission is hereby granted, free of charge, to any person obtaining a copy
     * of this software and associated documentation files (the "Software"), to deal
     * in the Software without restriction, including without limitation the rights
     * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
     * copies of the Software, and to permit persons to whom the Software is
     * furnished to do so, subject to the following conditions:
     *
     * The above copyright notice and this permission notice shall be included in
     * all copies or substantial portions of the Software.
     *
     * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
     * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
     * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
     * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
     * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
     * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
     * THE SOFTWARE.
     */
    var MDCFoundation = /** @class */ (function () {
        function MDCFoundation(adapter) {
            if (adapter === void 0) { adapter = {}; }
            this.adapter_ = adapter;
        }
        Object.defineProperty(MDCFoundation, "cssClasses", {
            get: function () {
                // Classes extending MDCFoundation should implement this method to return an object which exports every
                // CSS class the foundation class needs as a property. e.g. {ACTIVE: 'mdc-component--active'}
                return {};
            },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(MDCFoundation, "strings", {
            get: function () {
                // Classes extending MDCFoundation should implement this method to return an object which exports all
                // semantic strings as constants. e.g. {ARIA_ROLE: 'tablist'}
                return {};
            },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(MDCFoundation, "numbers", {
            get: function () {
                // Classes extending MDCFoundation should implement this method to return an object which exports all
                // of its semantic numbers as constants. e.g. {ANIMATION_DELAY_MS: 350}
                return {};
            },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(MDCFoundation, "defaultAdapter", {
            get: function () {
                // Classes extending MDCFoundation may choose to implement this getter in order to provide a convenient
                // way of viewing the necessary methods of an adapter. In the future, this could also be used for adapter
                // validation.
                return {};
            },
            enumerable: true,
            configurable: true
        });
        MDCFoundation.prototype.init = function () {
            // Subclasses should override this method to perform initialization routines (registering events, etc.)
        };
        MDCFoundation.prototype.destroy = function () {
            // Subclasses should override this method to perform de-initialization routines (de-registering events, etc.)
        };
        return MDCFoundation;
    }());

    /**
     * @license
     * Copyright 2016 Google Inc.
     *
     * Permission is hereby granted, free of charge, to any person obtaining a copy
     * of this software and associated documentation files (the "Software"), to deal
     * in the Software without restriction, including without limitation the rights
     * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
     * copies of the Software, and to permit persons to whom the Software is
     * furnished to do so, subject to the following conditions:
     *
     * The above copyright notice and this permission notice shall be included in
     * all copies or substantial portions of the Software.
     *
     * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
     * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
     * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
     * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
     * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
     * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
     * THE SOFTWARE.
     */
    var MDCComponent = /** @class */ (function () {
        function MDCComponent(root, foundation) {
            var args = [];
            for (var _i = 2; _i < arguments.length; _i++) {
                args[_i - 2] = arguments[_i];
            }
            this.root_ = root;
            this.initialize.apply(this, __spread(args));
            // Note that we initialize foundation here and not within the constructor's default param so that
            // this.root_ is defined and can be used within the foundation class.
            this.foundation_ = foundation === undefined ? this.getDefaultFoundation() : foundation;
            this.foundation_.init();
            this.initialSyncWithDOM();
        }
        MDCComponent.attachTo = function (root) {
            // Subclasses which extend MDCBase should provide an attachTo() method that takes a root element and
            // returns an instantiated component with its root set to that element. Also note that in the cases of
            // subclasses, an explicit foundation class will not have to be passed in; it will simply be initialized
            // from getDefaultFoundation().
            return new MDCComponent(root, new MDCFoundation({}));
        };
        /* istanbul ignore next: method param only exists for typing purposes; it does not need to be unit tested */
        MDCComponent.prototype.initialize = function () {
            var _args = [];
            for (var _i = 0; _i < arguments.length; _i++) {
                _args[_i] = arguments[_i];
            }
            // Subclasses can override this to do any additional setup work that would be considered part of a
            // "constructor". Essentially, it is a hook into the parent constructor before the foundation is
            // initialized. Any additional arguments besides root and foundation will be passed in here.
        };
        MDCComponent.prototype.getDefaultFoundation = function () {
            // Subclasses must override this method to return a properly configured foundation class for the
            // component.
            throw new Error('Subclasses must override getDefaultFoundation to return a properly configured ' +
                'foundation class');
        };
        MDCComponent.prototype.initialSyncWithDOM = function () {
            // Subclasses should override this method if they need to perform work to synchronize with a host DOM
            // object. An example of this would be a form control wrapper that needs to synchronize its internal state
            // to some property or attribute of the host DOM. Please note: this is *not* the place to perform DOM
            // reads/writes that would cause layout / paint, as this is called synchronously from within the constructor.
        };
        MDCComponent.prototype.destroy = function () {
            // Subclasses may implement this method to release any resources / deregister any listeners they have
            // attached. An example of this might be deregistering a resize event from the window object.
            this.foundation_.destroy();
        };
        MDCComponent.prototype.listen = function (evtType, handler, options) {
            this.root_.addEventListener(evtType, handler, options);
        };
        MDCComponent.prototype.unlisten = function (evtType, handler, options) {
            this.root_.removeEventListener(evtType, handler, options);
        };
        /**
         * Fires a cross-browser-compatible custom event from the component root of the given type, with the given data.
         */
        MDCComponent.prototype.emit = function (evtType, evtData, shouldBubble) {
            if (shouldBubble === void 0) { shouldBubble = false; }
            var evt;
            if (typeof CustomEvent === 'function') {
                evt = new CustomEvent(evtType, {
                    bubbles: shouldBubble,
                    detail: evtData,
                });
            }
            else {
                evt = document.createEvent('CustomEvent');
                evt.initCustomEvent(evtType, shouldBubble, false, evtData);
            }
            this.root_.dispatchEvent(evt);
        };
        return MDCComponent;
    }());

    /**
     * @license
     * Copyright 2019 Google Inc.
     *
     * Permission is hereby granted, free of charge, to any person obtaining a copy
     * of this software and associated documentation files (the "Software"), to deal
     * in the Software without restriction, including without limitation the rights
     * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
     * copies of the Software, and to permit persons to whom the Software is
     * furnished to do so, subject to the following conditions:
     *
     * The above copyright notice and this permission notice shall be included in
     * all copies or substantial portions of the Software.
     *
     * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
     * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
     * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
     * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
     * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
     * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
     * THE SOFTWARE.
     */
    /**
     * Stores result from applyPassive to avoid redundant processing to detect
     * passive event listener support.
     */
    var supportsPassive_;
    /**
     * Determine whether the current browser supports passive event listeners, and
     * if so, use them.
     */
    function applyPassive(globalObj, forceRefresh) {
        if (globalObj === void 0) { globalObj = window; }
        if (forceRefresh === void 0) { forceRefresh = false; }
        if (supportsPassive_ === undefined || forceRefresh) {
            var isSupported_1 = false;
            try {
                globalObj.document.addEventListener('test', function () { return undefined; }, {
                    get passive() {
                        isSupported_1 = true;
                        return isSupported_1;
                    },
                });
            }
            catch (e) {
            } // tslint:disable-line:no-empty cannot throw error due to tests. tslint also disables console.log.
            supportsPassive_ = isSupported_1;
        }
        return supportsPassive_ ? { passive: true } : false;
    }

    /**
     * @license
     * Copyright 2018 Google Inc.
     *
     * Permission is hereby granted, free of charge, to any person obtaining a copy
     * of this software and associated documentation files (the "Software"), to deal
     * in the Software without restriction, including without limitation the rights
     * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
     * copies of the Software, and to permit persons to whom the Software is
     * furnished to do so, subject to the following conditions:
     *
     * The above copyright notice and this permission notice shall be included in
     * all copies or substantial portions of the Software.
     *
     * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
     * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
     * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
     * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
     * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
     * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
     * THE SOFTWARE.
     */
    function matches(element, selector) {
        var nativeMatches = element.matches
            || element.webkitMatchesSelector
            || element.msMatchesSelector;
        return nativeMatches.call(element, selector);
    }

    /**
     * @license
     * Copyright 2016 Google Inc.
     *
     * Permission is hereby granted, free of charge, to any person obtaining a copy
     * of this software and associated documentation files (the "Software"), to deal
     * in the Software without restriction, including without limitation the rights
     * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
     * copies of the Software, and to permit persons to whom the Software is
     * furnished to do so, subject to the following conditions:
     *
     * The above copyright notice and this permission notice shall be included in
     * all copies or substantial portions of the Software.
     *
     * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
     * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
     * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
     * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
     * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
     * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
     * THE SOFTWARE.
     */
    var cssClasses = {
        // Ripple is a special case where the "root" component is really a "mixin" of sorts,
        // given that it's an 'upgrade' to an existing component. That being said it is the root
        // CSS class that all other CSS classes derive from.
        BG_FOCUSED: 'mdc-ripple-upgraded--background-focused',
        FG_ACTIVATION: 'mdc-ripple-upgraded--foreground-activation',
        FG_DEACTIVATION: 'mdc-ripple-upgraded--foreground-deactivation',
        ROOT: 'mdc-ripple-upgraded',
        UNBOUNDED: 'mdc-ripple-upgraded--unbounded',
    };
    var strings = {
        VAR_FG_SCALE: '--mdc-ripple-fg-scale',
        VAR_FG_SIZE: '--mdc-ripple-fg-size',
        VAR_FG_TRANSLATE_END: '--mdc-ripple-fg-translate-end',
        VAR_FG_TRANSLATE_START: '--mdc-ripple-fg-translate-start',
        VAR_LEFT: '--mdc-ripple-left',
        VAR_TOP: '--mdc-ripple-top',
    };
    var numbers = {
        DEACTIVATION_TIMEOUT_MS: 225,
        FG_DEACTIVATION_MS: 150,
        INITIAL_ORIGIN_SCALE: 0.6,
        PADDING: 10,
        TAP_DELAY_MS: 300,
    };

    /**
     * @license
     * Copyright 2016 Google Inc.
     *
     * Permission is hereby granted, free of charge, to any person obtaining a copy
     * of this software and associated documentation files (the "Software"), to deal
     * in the Software without restriction, including without limitation the rights
     * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
     * copies of the Software, and to permit persons to whom the Software is
     * furnished to do so, subject to the following conditions:
     *
     * The above copyright notice and this permission notice shall be included in
     * all copies or substantial portions of the Software.
     *
     * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
     * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
     * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
     * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
     * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
     * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
     * THE SOFTWARE.
     */
    // Activation events registered on the root element of each instance for activation
    var ACTIVATION_EVENT_TYPES = [
        'touchstart', 'pointerdown', 'mousedown', 'keydown',
    ];
    // Deactivation events registered on documentElement when a pointer-related down event occurs
    var POINTER_DEACTIVATION_EVENT_TYPES = [
        'touchend', 'pointerup', 'mouseup', 'contextmenu',
    ];
    // simultaneous nested activations
    var activatedTargets = [];
    var MDCRippleFoundation = /** @class */ (function (_super) {
        __extends(MDCRippleFoundation, _super);
        function MDCRippleFoundation(adapter) {
            var _this = _super.call(this, __assign({}, MDCRippleFoundation.defaultAdapter, adapter)) || this;
            _this.activationAnimationHasEnded_ = false;
            _this.activationTimer_ = 0;
            _this.fgDeactivationRemovalTimer_ = 0;
            _this.fgScale_ = '0';
            _this.frame_ = { width: 0, height: 0 };
            _this.initialSize_ = 0;
            _this.layoutFrame_ = 0;
            _this.maxRadius_ = 0;
            _this.unboundedCoords_ = { left: 0, top: 0 };
            _this.activationState_ = _this.defaultActivationState_();
            _this.activationTimerCallback_ = function () {
                _this.activationAnimationHasEnded_ = true;
                _this.runDeactivationUXLogicIfReady_();
            };
            _this.activateHandler_ = function (e) { return _this.activate_(e); };
            _this.deactivateHandler_ = function () { return _this.deactivate_(); };
            _this.focusHandler_ = function () { return _this.handleFocus(); };
            _this.blurHandler_ = function () { return _this.handleBlur(); };
            _this.resizeHandler_ = function () { return _this.layout(); };
            return _this;
        }
        Object.defineProperty(MDCRippleFoundation, "cssClasses", {
            get: function () {
                return cssClasses;
            },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(MDCRippleFoundation, "strings", {
            get: function () {
                return strings;
            },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(MDCRippleFoundation, "numbers", {
            get: function () {
                return numbers;
            },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(MDCRippleFoundation, "defaultAdapter", {
            get: function () {
                return {
                    addClass: function () { return undefined; },
                    browserSupportsCssVars: function () { return true; },
                    computeBoundingRect: function () { return ({ top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0 }); },
                    containsEventTarget: function () { return true; },
                    deregisterDocumentInteractionHandler: function () { return undefined; },
                    deregisterInteractionHandler: function () { return undefined; },
                    deregisterResizeHandler: function () { return undefined; },
                    getWindowPageOffset: function () { return ({ x: 0, y: 0 }); },
                    isSurfaceActive: function () { return true; },
                    isSurfaceDisabled: function () { return true; },
                    isUnbounded: function () { return true; },
                    registerDocumentInteractionHandler: function () { return undefined; },
                    registerInteractionHandler: function () { return undefined; },
                    registerResizeHandler: function () { return undefined; },
                    removeClass: function () { return undefined; },
                    updateCssVariable: function () { return undefined; },
                };
            },
            enumerable: true,
            configurable: true
        });
        MDCRippleFoundation.prototype.init = function () {
            var _this = this;
            var supportsPressRipple = this.supportsPressRipple_();
            this.registerRootHandlers_(supportsPressRipple);
            if (supportsPressRipple) {
                var _a = MDCRippleFoundation.cssClasses, ROOT_1 = _a.ROOT, UNBOUNDED_1 = _a.UNBOUNDED;
                requestAnimationFrame(function () {
                    _this.adapter_.addClass(ROOT_1);
                    if (_this.adapter_.isUnbounded()) {
                        _this.adapter_.addClass(UNBOUNDED_1);
                        // Unbounded ripples need layout logic applied immediately to set coordinates for both shade and ripple
                        _this.layoutInternal_();
                    }
                });
            }
        };
        MDCRippleFoundation.prototype.destroy = function () {
            var _this = this;
            if (this.supportsPressRipple_()) {
                if (this.activationTimer_) {
                    clearTimeout(this.activationTimer_);
                    this.activationTimer_ = 0;
                    this.adapter_.removeClass(MDCRippleFoundation.cssClasses.FG_ACTIVATION);
                }
                if (this.fgDeactivationRemovalTimer_) {
                    clearTimeout(this.fgDeactivationRemovalTimer_);
                    this.fgDeactivationRemovalTimer_ = 0;
                    this.adapter_.removeClass(MDCRippleFoundation.cssClasses.FG_DEACTIVATION);
                }
                var _a = MDCRippleFoundation.cssClasses, ROOT_2 = _a.ROOT, UNBOUNDED_2 = _a.UNBOUNDED;
                requestAnimationFrame(function () {
                    _this.adapter_.removeClass(ROOT_2);
                    _this.adapter_.removeClass(UNBOUNDED_2);
                    _this.removeCssVars_();
                });
            }
            this.deregisterRootHandlers_();
            this.deregisterDeactivationHandlers_();
        };
        /**
         * @param evt Optional event containing position information.
         */
        MDCRippleFoundation.prototype.activate = function (evt) {
            this.activate_(evt);
        };
        MDCRippleFoundation.prototype.deactivate = function () {
            this.deactivate_();
        };
        MDCRippleFoundation.prototype.layout = function () {
            var _this = this;
            if (this.layoutFrame_) {
                cancelAnimationFrame(this.layoutFrame_);
            }
            this.layoutFrame_ = requestAnimationFrame(function () {
                _this.layoutInternal_();
                _this.layoutFrame_ = 0;
            });
        };
        MDCRippleFoundation.prototype.setUnbounded = function (unbounded) {
            var UNBOUNDED = MDCRippleFoundation.cssClasses.UNBOUNDED;
            if (unbounded) {
                this.adapter_.addClass(UNBOUNDED);
            }
            else {
                this.adapter_.removeClass(UNBOUNDED);
            }
        };
        MDCRippleFoundation.prototype.handleFocus = function () {
            var _this = this;
            requestAnimationFrame(function () {
                return _this.adapter_.addClass(MDCRippleFoundation.cssClasses.BG_FOCUSED);
            });
        };
        MDCRippleFoundation.prototype.handleBlur = function () {
            var _this = this;
            requestAnimationFrame(function () {
                return _this.adapter_.removeClass(MDCRippleFoundation.cssClasses.BG_FOCUSED);
            });
        };
        /**
         * We compute this property so that we are not querying information about the client
         * until the point in time where the foundation requests it. This prevents scenarios where
         * client-side feature-detection may happen too early, such as when components are rendered on the server
         * and then initialized at mount time on the client.
         */
        MDCRippleFoundation.prototype.supportsPressRipple_ = function () {
            return this.adapter_.browserSupportsCssVars();
        };
        MDCRippleFoundation.prototype.defaultActivationState_ = function () {
            return {
                activationEvent: undefined,
                hasDeactivationUXRun: false,
                isActivated: false,
                isProgrammatic: false,
                wasActivatedByPointer: false,
                wasElementMadeActive: false,
            };
        };
        /**
         * supportsPressRipple Passed from init to save a redundant function call
         */
        MDCRippleFoundation.prototype.registerRootHandlers_ = function (supportsPressRipple) {
            var _this = this;
            if (supportsPressRipple) {
                ACTIVATION_EVENT_TYPES.forEach(function (evtType) {
                    _this.adapter_.registerInteractionHandler(evtType, _this.activateHandler_);
                });
                if (this.adapter_.isUnbounded()) {
                    this.adapter_.registerResizeHandler(this.resizeHandler_);
                }
            }
            this.adapter_.registerInteractionHandler('focus', this.focusHandler_);
            this.adapter_.registerInteractionHandler('blur', this.blurHandler_);
        };
        MDCRippleFoundation.prototype.registerDeactivationHandlers_ = function (evt) {
            var _this = this;
            if (evt.type === 'keydown') {
                this.adapter_.registerInteractionHandler('keyup', this.deactivateHandler_);
            }
            else {
                POINTER_DEACTIVATION_EVENT_TYPES.forEach(function (evtType) {
                    _this.adapter_.registerDocumentInteractionHandler(evtType, _this.deactivateHandler_);
                });
            }
        };
        MDCRippleFoundation.prototype.deregisterRootHandlers_ = function () {
            var _this = this;
            ACTIVATION_EVENT_TYPES.forEach(function (evtType) {
                _this.adapter_.deregisterInteractionHandler(evtType, _this.activateHandler_);
            });
            this.adapter_.deregisterInteractionHandler('focus', this.focusHandler_);
            this.adapter_.deregisterInteractionHandler('blur', this.blurHandler_);
            if (this.adapter_.isUnbounded()) {
                this.adapter_.deregisterResizeHandler(this.resizeHandler_);
            }
        };
        MDCRippleFoundation.prototype.deregisterDeactivationHandlers_ = function () {
            var _this = this;
            this.adapter_.deregisterInteractionHandler('keyup', this.deactivateHandler_);
            POINTER_DEACTIVATION_EVENT_TYPES.forEach(function (evtType) {
                _this.adapter_.deregisterDocumentInteractionHandler(evtType, _this.deactivateHandler_);
            });
        };
        MDCRippleFoundation.prototype.removeCssVars_ = function () {
            var _this = this;
            var rippleStrings = MDCRippleFoundation.strings;
            var keys = Object.keys(rippleStrings);
            keys.forEach(function (key) {
                if (key.indexOf('VAR_') === 0) {
                    _this.adapter_.updateCssVariable(rippleStrings[key], null);
                }
            });
        };
        MDCRippleFoundation.prototype.activate_ = function (evt) {
            var _this = this;
            if (this.adapter_.isSurfaceDisabled()) {
                return;
            }
            var activationState = this.activationState_;
            if (activationState.isActivated) {
                return;
            }
            // Avoid reacting to follow-on events fired by touch device after an already-processed user interaction
            var previousActivationEvent = this.previousActivationEvent_;
            var isSameInteraction = previousActivationEvent && evt !== undefined && previousActivationEvent.type !== evt.type;
            if (isSameInteraction) {
                return;
            }
            activationState.isActivated = true;
            activationState.isProgrammatic = evt === undefined;
            activationState.activationEvent = evt;
            activationState.wasActivatedByPointer = activationState.isProgrammatic ? false : evt !== undefined && (evt.type === 'mousedown' || evt.type === 'touchstart' || evt.type === 'pointerdown');
            var hasActivatedChild = evt !== undefined && activatedTargets.length > 0 && activatedTargets.some(function (target) { return _this.adapter_.containsEventTarget(target); });
            if (hasActivatedChild) {
                // Immediately reset activation state, while preserving logic that prevents touch follow-on events
                this.resetActivationState_();
                return;
            }
            if (evt !== undefined) {
                activatedTargets.push(evt.target);
                this.registerDeactivationHandlers_(evt);
            }
            activationState.wasElementMadeActive = this.checkElementMadeActive_(evt);
            if (activationState.wasElementMadeActive) {
                this.animateActivation_();
            }
            requestAnimationFrame(function () {
                // Reset array on next frame after the current event has had a chance to bubble to prevent ancestor ripples
                activatedTargets = [];
                if (!activationState.wasElementMadeActive
                    && evt !== undefined
                    && (evt.key === ' ' || evt.keyCode === 32)) {
                    // If space was pressed, try again within an rAF call to detect :active, because different UAs report
                    // active states inconsistently when they're called within event handling code:
                    // - https://bugs.chromium.org/p/chromium/issues/detail?id=635971
                    // - https://bugzilla.mozilla.org/show_bug.cgi?id=1293741
                    // We try first outside rAF to support Edge, which does not exhibit this problem, but will crash if a CSS
                    // variable is set within a rAF callback for a submit button interaction (#2241).
                    activationState.wasElementMadeActive = _this.checkElementMadeActive_(evt);
                    if (activationState.wasElementMadeActive) {
                        _this.animateActivation_();
                    }
                }
                if (!activationState.wasElementMadeActive) {
                    // Reset activation state immediately if element was not made active.
                    _this.activationState_ = _this.defaultActivationState_();
                }
            });
        };
        MDCRippleFoundation.prototype.checkElementMadeActive_ = function (evt) {
            return (evt !== undefined && evt.type === 'keydown') ? this.adapter_.isSurfaceActive() : true;
        };
        MDCRippleFoundation.prototype.animateActivation_ = function () {
            var _this = this;
            var _a = MDCRippleFoundation.strings, VAR_FG_TRANSLATE_START = _a.VAR_FG_TRANSLATE_START, VAR_FG_TRANSLATE_END = _a.VAR_FG_TRANSLATE_END;
            var _b = MDCRippleFoundation.cssClasses, FG_DEACTIVATION = _b.FG_DEACTIVATION, FG_ACTIVATION = _b.FG_ACTIVATION;
            var DEACTIVATION_TIMEOUT_MS = MDCRippleFoundation.numbers.DEACTIVATION_TIMEOUT_MS;
            this.layoutInternal_();
            var translateStart = '';
            var translateEnd = '';
            if (!this.adapter_.isUnbounded()) {
                var _c = this.getFgTranslationCoordinates_(), startPoint = _c.startPoint, endPoint = _c.endPoint;
                translateStart = startPoint.x + "px, " + startPoint.y + "px";
                translateEnd = endPoint.x + "px, " + endPoint.y + "px";
            }
            this.adapter_.updateCssVariable(VAR_FG_TRANSLATE_START, translateStart);
            this.adapter_.updateCssVariable(VAR_FG_TRANSLATE_END, translateEnd);
            // Cancel any ongoing activation/deactivation animations
            clearTimeout(this.activationTimer_);
            clearTimeout(this.fgDeactivationRemovalTimer_);
            this.rmBoundedActivationClasses_();
            this.adapter_.removeClass(FG_DEACTIVATION);
            // Force layout in order to re-trigger the animation.
            this.adapter_.computeBoundingRect();
            this.adapter_.addClass(FG_ACTIVATION);
            this.activationTimer_ = setTimeout(function () { return _this.activationTimerCallback_(); }, DEACTIVATION_TIMEOUT_MS);
        };
        MDCRippleFoundation.prototype.getFgTranslationCoordinates_ = function () {
            var _a = this.activationState_, activationEvent = _a.activationEvent, wasActivatedByPointer = _a.wasActivatedByPointer;
            var startPoint;
            if (wasActivatedByPointer) {
                startPoint = getNormalizedEventCoords(activationEvent, this.adapter_.getWindowPageOffset(), this.adapter_.computeBoundingRect());
            }
            else {
                startPoint = {
                    x: this.frame_.width / 2,
                    y: this.frame_.height / 2,
                };
            }
            // Center the element around the start point.
            startPoint = {
                x: startPoint.x - (this.initialSize_ / 2),
                y: startPoint.y - (this.initialSize_ / 2),
            };
            var endPoint = {
                x: (this.frame_.width / 2) - (this.initialSize_ / 2),
                y: (this.frame_.height / 2) - (this.initialSize_ / 2),
            };
            return { startPoint: startPoint, endPoint: endPoint };
        };
        MDCRippleFoundation.prototype.runDeactivationUXLogicIfReady_ = function () {
            var _this = this;
            // This method is called both when a pointing device is released, and when the activation animation ends.
            // The deactivation animation should only run after both of those occur.
            var FG_DEACTIVATION = MDCRippleFoundation.cssClasses.FG_DEACTIVATION;
            var _a = this.activationState_, hasDeactivationUXRun = _a.hasDeactivationUXRun, isActivated = _a.isActivated;
            var activationHasEnded = hasDeactivationUXRun || !isActivated;
            if (activationHasEnded && this.activationAnimationHasEnded_) {
                this.rmBoundedActivationClasses_();
                this.adapter_.addClass(FG_DEACTIVATION);
                this.fgDeactivationRemovalTimer_ = setTimeout(function () {
                    _this.adapter_.removeClass(FG_DEACTIVATION);
                }, numbers.FG_DEACTIVATION_MS);
            }
        };
        MDCRippleFoundation.prototype.rmBoundedActivationClasses_ = function () {
            var FG_ACTIVATION = MDCRippleFoundation.cssClasses.FG_ACTIVATION;
            this.adapter_.removeClass(FG_ACTIVATION);
            this.activationAnimationHasEnded_ = false;
            this.adapter_.computeBoundingRect();
        };
        MDCRippleFoundation.prototype.resetActivationState_ = function () {
            var _this = this;
            this.previousActivationEvent_ = this.activationState_.activationEvent;
            this.activationState_ = this.defaultActivationState_();
            // Touch devices may fire additional events for the same interaction within a short time.
            // Store the previous event until it's safe to assume that subsequent events are for new interactions.
            setTimeout(function () { return _this.previousActivationEvent_ = undefined; }, MDCRippleFoundation.numbers.TAP_DELAY_MS);
        };
        MDCRippleFoundation.prototype.deactivate_ = function () {
            var _this = this;
            var activationState = this.activationState_;
            // This can happen in scenarios such as when you have a keyup event that blurs the element.
            if (!activationState.isActivated) {
                return;
            }
            var state = __assign({}, activationState);
            if (activationState.isProgrammatic) {
                requestAnimationFrame(function () { return _this.animateDeactivation_(state); });
                this.resetActivationState_();
            }
            else {
                this.deregisterDeactivationHandlers_();
                requestAnimationFrame(function () {
                    _this.activationState_.hasDeactivationUXRun = true;
                    _this.animateDeactivation_(state);
                    _this.resetActivationState_();
                });
            }
        };
        MDCRippleFoundation.prototype.animateDeactivation_ = function (_a) {
            var wasActivatedByPointer = _a.wasActivatedByPointer, wasElementMadeActive = _a.wasElementMadeActive;
            if (wasActivatedByPointer || wasElementMadeActive) {
                this.runDeactivationUXLogicIfReady_();
            }
        };
        MDCRippleFoundation.prototype.layoutInternal_ = function () {
            var _this = this;
            this.frame_ = this.adapter_.computeBoundingRect();
            var maxDim = Math.max(this.frame_.height, this.frame_.width);
            // Surface diameter is treated differently for unbounded vs. bounded ripples.
            // Unbounded ripple diameter is calculated smaller since the surface is expected to already be padded appropriately
            // to extend the hitbox, and the ripple is expected to meet the edges of the padded hitbox (which is typically
            // square). Bounded ripples, on the other hand, are fully expected to expand beyond the surface's longest diameter
            // (calculated based on the diagonal plus a constant padding), and are clipped at the surface's border via
            // `overflow: hidden`.
            var getBoundedRadius = function () {
                var hypotenuse = Math.sqrt(Math.pow(_this.frame_.width, 2) + Math.pow(_this.frame_.height, 2));
                return hypotenuse + MDCRippleFoundation.numbers.PADDING;
            };
            this.maxRadius_ = this.adapter_.isUnbounded() ? maxDim : getBoundedRadius();
            // Ripple is sized as a fraction of the largest dimension of the surface, then scales up using a CSS scale transform
            this.initialSize_ = Math.floor(maxDim * MDCRippleFoundation.numbers.INITIAL_ORIGIN_SCALE);
            this.fgScale_ = "" + this.maxRadius_ / this.initialSize_;
            this.updateLayoutCssVars_();
        };
        MDCRippleFoundation.prototype.updateLayoutCssVars_ = function () {
            var _a = MDCRippleFoundation.strings, VAR_FG_SIZE = _a.VAR_FG_SIZE, VAR_LEFT = _a.VAR_LEFT, VAR_TOP = _a.VAR_TOP, VAR_FG_SCALE = _a.VAR_FG_SCALE;
            this.adapter_.updateCssVariable(VAR_FG_SIZE, this.initialSize_ + "px");
            this.adapter_.updateCssVariable(VAR_FG_SCALE, this.fgScale_);
            if (this.adapter_.isUnbounded()) {
                this.unboundedCoords_ = {
                    left: Math.round((this.frame_.width / 2) - (this.initialSize_ / 2)),
                    top: Math.round((this.frame_.height / 2) - (this.initialSize_ / 2)),
                };
                this.adapter_.updateCssVariable(VAR_LEFT, this.unboundedCoords_.left + "px");
                this.adapter_.updateCssVariable(VAR_TOP, this.unboundedCoords_.top + "px");
            }
        };
        return MDCRippleFoundation;
    }(MDCFoundation));

    /**
     * @license
     * Copyright 2016 Google Inc.
     *
     * Permission is hereby granted, free of charge, to any person obtaining a copy
     * of this software and associated documentation files (the "Software"), to deal
     * in the Software without restriction, including without limitation the rights
     * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
     * copies of the Software, and to permit persons to whom the Software is
     * furnished to do so, subject to the following conditions:
     *
     * The above copyright notice and this permission notice shall be included in
     * all copies or substantial portions of the Software.
     *
     * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
     * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
     * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
     * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
     * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
     * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
     * THE SOFTWARE.
     */
    var MDCRipple = /** @class */ (function (_super) {
        __extends(MDCRipple, _super);
        function MDCRipple() {
            var _this = _super !== null && _super.apply(this, arguments) || this;
            _this.disabled = false;
            return _this;
        }
        MDCRipple.attachTo = function (root, opts) {
            if (opts === void 0) { opts = { isUnbounded: undefined }; }
            var ripple = new MDCRipple(root);
            // Only override unbounded behavior if option is explicitly specified
            if (opts.isUnbounded !== undefined) {
                ripple.unbounded = opts.isUnbounded;
            }
            return ripple;
        };
        MDCRipple.createAdapter = function (instance) {
            return {
                addClass: function (className) { return instance.root_.classList.add(className); },
                browserSupportsCssVars: function () { return supportsCssVariables(window); },
                computeBoundingRect: function () { return instance.root_.getBoundingClientRect(); },
                containsEventTarget: function (target) { return instance.root_.contains(target); },
                deregisterDocumentInteractionHandler: function (evtType, handler) {
                    return document.documentElement.removeEventListener(evtType, handler, applyPassive());
                },
                deregisterInteractionHandler: function (evtType, handler) {
                    return instance.root_.removeEventListener(evtType, handler, applyPassive());
                },
                deregisterResizeHandler: function (handler) { return window.removeEventListener('resize', handler); },
                getWindowPageOffset: function () { return ({ x: window.pageXOffset, y: window.pageYOffset }); },
                isSurfaceActive: function () { return matches(instance.root_, ':active'); },
                isSurfaceDisabled: function () { return Boolean(instance.disabled); },
                isUnbounded: function () { return Boolean(instance.unbounded); },
                registerDocumentInteractionHandler: function (evtType, handler) {
                    return document.documentElement.addEventListener(evtType, handler, applyPassive());
                },
                registerInteractionHandler: function (evtType, handler) {
                    return instance.root_.addEventListener(evtType, handler, applyPassive());
                },
                registerResizeHandler: function (handler) { return window.addEventListener('resize', handler); },
                removeClass: function (className) { return instance.root_.classList.remove(className); },
                updateCssVariable: function (varName, value) { return instance.root_.style.setProperty(varName, value); },
            };
        };
        Object.defineProperty(MDCRipple.prototype, "unbounded", {
            get: function () {
                return Boolean(this.unbounded_);
            },
            set: function (unbounded) {
                this.unbounded_ = Boolean(unbounded);
                this.setUnbounded_();
            },
            enumerable: true,
            configurable: true
        });
        MDCRipple.prototype.activate = function () {
            this.foundation_.activate();
        };
        MDCRipple.prototype.deactivate = function () {
            this.foundation_.deactivate();
        };
        MDCRipple.prototype.layout = function () {
            this.foundation_.layout();
        };
        MDCRipple.prototype.getDefaultFoundation = function () {
            return new MDCRippleFoundation(MDCRipple.createAdapter(this));
        };
        MDCRipple.prototype.initialSyncWithDOM = function () {
            var root = this.root_;
            this.unbounded = 'mdcRippleIsUnbounded' in root.dataset;
        };
        /**
         * Closure Compiler throws an access control error when directly accessing a
         * protected or private property inside a getter/setter, like unbounded above.
         * By accessing the protected property inside a method, we solve that problem.
         * That's why this function exists.
         */
        MDCRipple.prototype.setUnbounded_ = function () {
            this.foundation_.setUnbounded(Boolean(this.unbounded_));
        };
        return MDCRipple;
    }(MDCComponent));

    function Ripple(node, props = {ripple: false, unbounded: false, color: null, classForward: () => {}}) {
      let instance = null;
      let addLayoutListener = getContext('SMUI:addLayoutListener');
      let removeLayoutListener;
      let classList = [];

      function addClass(className) {
        const idx = classList.indexOf(className);
        if (idx === -1) {
          node.classList.add(className);
          classList.push(className);
          if (props.classForward) {
            props.classForward(classList);
          }
        }
      }

      function removeClass(className) {
        const idx = classList.indexOf(className);
        if (idx !== -1) {
          node.classList.remove(className);
          classList.splice(idx, 1);
          if (props.classForward) {
            props.classForward(classList);
          }
        }
      }

      function handleProps() {
        if (props.ripple && !instance) {
          // Override the Ripple component's adapter, so that we can forward classes
          // to Svelte components that overwrite Ripple's classes.
          const _createAdapter = MDCRipple.createAdapter;
          MDCRipple.createAdapter = function(...args) {
            const adapter = _createAdapter.apply(this, args);
            adapter.addClass = function(className) {
              return addClass(className);
            };
            adapter.removeClass = function(className) {
              return removeClass(className);
            };
            return adapter;
          };
          instance = new MDCRipple(node);
          MDCRipple.createAdapter = _createAdapter;
        } else if (instance && !props.ripple) {
          instance.destroy();
          instance = null;
        }
        if (props.ripple) {
          instance.unbounded = !!props.unbounded;
          switch (props.color) {
            case 'surface':
              addClass('mdc-ripple-surface');
              removeClass('mdc-ripple-surface--primary');
              removeClass('mdc-ripple-surface--accent');
              return;
            case 'primary':
              addClass('mdc-ripple-surface');
              addClass('mdc-ripple-surface--primary');
              removeClass('mdc-ripple-surface--accent');
              return;
            case 'secondary':
              addClass('mdc-ripple-surface');
              removeClass('mdc-ripple-surface--primary');
              addClass('mdc-ripple-surface--accent');
              return;
          }
        }
        removeClass('mdc-ripple-surface');
        removeClass('mdc-ripple-surface--primary');
        removeClass('mdc-ripple-surface--accent');
      }

      handleProps();

      if (addLayoutListener) {
        removeLayoutListener = addLayoutListener(layout);
      }

      function layout() {
        if (instance) {
          instance.layout();
        }
      }

      return {
        update(newProps = {ripple: false, unbounded: false, color: null, classForward: []}) {
          props = newProps;
          handleProps();
        },

        destroy() {
          if (instance) {
            instance.destroy();
            instance = null;
            removeClass('mdc-ripple-surface');
            removeClass('mdc-ripple-surface--primary');
            removeClass('mdc-ripple-surface--accent');
          }

          if (removeLayoutListener) {
            removeLayoutListener();
          }
        }
      }
    }

    function styleInject(css, ref) {
      if ( ref === void 0 ) ref = {};
      var insertAt = ref.insertAt;

      if (!css || typeof document === 'undefined') { return; }

      var head = document.head || document.getElementsByTagName('head')[0];
      var style = document.createElement('style');
      style.type = 'text/css';

      if (insertAt === 'top') {
        if (head.firstChild) {
          head.insertBefore(style, head.firstChild);
        } else {
          head.appendChild(style);
        }
      } else {
        head.appendChild(style);
      }

      if (style.styleSheet) {
        style.styleSheet.cssText = css;
      } else {
        style.appendChild(document.createTextNode(css));
      }
    }

    var css_248z = ".mdc-card {\n  border-radius: 4px;\n  background-color: #fff;\n  /* @alternate */\n  background-color: var(--mdc-theme-surface, #fff);\n  box-shadow: 0px 2px 1px -1px rgba(0, 0, 0, 0.2), 0px 1px 1px 0px rgba(0, 0, 0, 0.14), 0px 1px 3px 0px rgba(0, 0, 0, 0.12);\n  display: flex;\n  flex-direction: column;\n  box-sizing: border-box;\n}\n\n.mdc-card--outlined {\n  box-shadow: 0px 0px 0px 0px rgba(0, 0, 0, 0.2), 0px 0px 0px 0px rgba(0, 0, 0, 0.14), 0px 0px 0px 0px rgba(0, 0, 0, 0.12);\n  border-width: 1px;\n  border-style: solid;\n  border-color: #e0e0e0;\n}\n\n.mdc-card__media {\n  position: relative;\n  box-sizing: border-box;\n  background-repeat: no-repeat;\n  background-position: center;\n  background-size: cover;\n}\n.mdc-card__media::before {\n  display: block;\n  content: \"\";\n}\n\n.mdc-card__media:first-child {\n  border-top-left-radius: inherit;\n  border-top-right-radius: inherit;\n}\n\n.mdc-card__media:last-child {\n  border-bottom-left-radius: inherit;\n  border-bottom-right-radius: inherit;\n}\n\n.mdc-card__media--square::before {\n  margin-top: 100%;\n}\n\n.mdc-card__media--16-9::before {\n  margin-top: 56.25%;\n}\n\n.mdc-card__media-content {\n  position: absolute;\n  top: 0;\n  right: 0;\n  bottom: 0;\n  left: 0;\n  box-sizing: border-box;\n}\n\n.mdc-card__primary-action {\n  display: flex;\n  flex-direction: column;\n  box-sizing: border-box;\n  position: relative;\n  outline: none;\n  color: inherit;\n  text-decoration: none;\n  cursor: pointer;\n  overflow: hidden;\n}\n\n.mdc-card__primary-action:first-child {\n  border-top-left-radius: inherit;\n  border-top-right-radius: inherit;\n}\n\n.mdc-card__primary-action:last-child {\n  border-bottom-left-radius: inherit;\n  border-bottom-right-radius: inherit;\n}\n\n.mdc-card__actions {\n  display: flex;\n  flex-direction: row;\n  align-items: center;\n  box-sizing: border-box;\n  min-height: 52px;\n  padding: 8px;\n}\n\n.mdc-card__actions--full-bleed {\n  padding: 0;\n}\n\n.mdc-card__action-buttons,\n.mdc-card__action-icons {\n  display: flex;\n  flex-direction: row;\n  align-items: center;\n  box-sizing: border-box;\n}\n\n.mdc-card__action-icons {\n  color: rgba(0, 0, 0, 0.6);\n  flex-grow: 1;\n  justify-content: flex-end;\n}\n\n.mdc-card__action-buttons + .mdc-card__action-icons {\n  /* @noflip */\n  margin-left: 16px;\n  /* @noflip */\n  margin-right: 0;\n}\n[dir=rtl] .mdc-card__action-buttons + .mdc-card__action-icons, .mdc-card__action-buttons + .mdc-card__action-icons[dir=rtl] {\n  /* @noflip */\n  margin-left: 0;\n  /* @noflip */\n  margin-right: 16px;\n}\n\n.mdc-card__action {\n  display: inline-flex;\n  flex-direction: row;\n  align-items: center;\n  box-sizing: border-box;\n  justify-content: center;\n  cursor: pointer;\n  user-select: none;\n}\n.mdc-card__action:focus {\n  outline: none;\n}\n\n.mdc-card__action--button {\n  /* @noflip */\n  margin-left: 0;\n  /* @noflip */\n  margin-right: 8px;\n  padding: 0 8px;\n}\n[dir=rtl] .mdc-card__action--button, .mdc-card__action--button[dir=rtl] {\n  /* @noflip */\n  margin-left: 8px;\n  /* @noflip */\n  margin-right: 0;\n}\n.mdc-card__action--button:last-child {\n  /* @noflip */\n  margin-left: 0;\n  /* @noflip */\n  margin-right: 0;\n}\n[dir=rtl] .mdc-card__action--button:last-child, .mdc-card__action--button:last-child[dir=rtl] {\n  /* @noflip */\n  margin-left: 0;\n  /* @noflip */\n  margin-right: 0;\n}\n\n.mdc-card__actions--full-bleed .mdc-card__action--button {\n  justify-content: space-between;\n  width: 100%;\n  height: auto;\n  max-height: none;\n  margin: 0;\n  padding: 8px 16px;\n  /* @noflip */\n  text-align: left;\n}\n[dir=rtl] .mdc-card__actions--full-bleed .mdc-card__action--button, .mdc-card__actions--full-bleed .mdc-card__action--button[dir=rtl] {\n  /* @noflip */\n  text-align: right;\n}\n\n.mdc-card__action--icon {\n  margin: -6px 0;\n  padding: 12px;\n}\n\n.mdc-card__action--icon:not(:disabled) {\n  color: rgba(0, 0, 0, 0.6);\n}\n\n@keyframes mdc-ripple-fg-radius-in {\n  from {\n    animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1);\n    transform: translate(var(--mdc-ripple-fg-translate-start, 0)) scale(1);\n  }\n  to {\n    transform: translate(var(--mdc-ripple-fg-translate-end, 0)) scale(var(--mdc-ripple-fg-scale, 1));\n  }\n}\n@keyframes mdc-ripple-fg-opacity-in {\n  from {\n    animation-timing-function: linear;\n    opacity: 0;\n  }\n  to {\n    opacity: var(--mdc-ripple-fg-opacity, 0);\n  }\n}\n@keyframes mdc-ripple-fg-opacity-out {\n  from {\n    animation-timing-function: linear;\n    opacity: var(--mdc-ripple-fg-opacity, 0);\n  }\n  to {\n    opacity: 0;\n  }\n}\n.mdc-ripple-surface--test-edge-var-bug {\n  --mdc-ripple-surface-test-edge-var: 1px solid #000;\n  visibility: hidden;\n}\n.mdc-ripple-surface--test-edge-var-bug::before {\n  border: var(--mdc-ripple-surface-test-edge-var);\n}\n\n.mdc-card__primary-action {\n  --mdc-ripple-fg-size: 0;\n  --mdc-ripple-left: 0;\n  --mdc-ripple-top: 0;\n  --mdc-ripple-fg-scale: 1;\n  --mdc-ripple-fg-translate-end: 0;\n  --mdc-ripple-fg-translate-start: 0;\n  -webkit-tap-highlight-color: rgba(0, 0, 0, 0);\n}\n.mdc-card__primary-action::before, .mdc-card__primary-action::after {\n  position: absolute;\n  border-radius: 50%;\n  opacity: 0;\n  pointer-events: none;\n  content: \"\";\n}\n.mdc-card__primary-action::before {\n  transition: opacity 15ms linear, background-color 15ms linear;\n  z-index: 1;\n}\n.mdc-card__primary-action.mdc-ripple-upgraded::before {\n  transform: scale(var(--mdc-ripple-fg-scale, 1));\n}\n.mdc-card__primary-action.mdc-ripple-upgraded::after {\n  top: 0;\n  /* @noflip */\n  left: 0;\n  transform: scale(0);\n  transform-origin: center center;\n}\n.mdc-card__primary-action.mdc-ripple-upgraded--unbounded::after {\n  top: var(--mdc-ripple-top, 0);\n  /* @noflip */\n  left: var(--mdc-ripple-left, 0);\n}\n.mdc-card__primary-action.mdc-ripple-upgraded--foreground-activation::after {\n  animation: mdc-ripple-fg-radius-in 225ms forwards, mdc-ripple-fg-opacity-in 75ms forwards;\n}\n.mdc-card__primary-action.mdc-ripple-upgraded--foreground-deactivation::after {\n  animation: mdc-ripple-fg-opacity-out 150ms;\n  transform: translate(var(--mdc-ripple-fg-translate-end, 0)) scale(var(--mdc-ripple-fg-scale, 1));\n}\n.mdc-card__primary-action::before, .mdc-card__primary-action::after {\n  top: calc(50% - 100%);\n  /* @noflip */\n  left: calc(50% - 100%);\n  width: 200%;\n  height: 200%;\n}\n.mdc-card__primary-action.mdc-ripple-upgraded::after {\n  width: var(--mdc-ripple-fg-size, 100%);\n  height: var(--mdc-ripple-fg-size, 100%);\n}\n.mdc-card__primary-action::before, .mdc-card__primary-action::after {\n  background-color: #000;\n}\n.mdc-card__primary-action:hover::before {\n  opacity: 0.04;\n}\n.mdc-card__primary-action:not(.mdc-ripple-upgraded):focus::before, .mdc-card__primary-action.mdc-ripple-upgraded--background-focused::before {\n  transition-duration: 75ms;\n  opacity: 0.12;\n}\n.mdc-card__primary-action:not(.mdc-ripple-upgraded)::after {\n  transition: opacity 150ms linear;\n}\n.mdc-card__primary-action:not(.mdc-ripple-upgraded):active::after {\n  transition-duration: 75ms;\n  opacity: 0.12;\n}\n.mdc-card__primary-action.mdc-ripple-upgraded {\n  --mdc-ripple-fg-opacity: 0.12;\n}\n\n.mdc-button {\n  font-family: Roboto, sans-serif;\n  -moz-osx-font-smoothing: grayscale;\n  -webkit-font-smoothing: antialiased;\n  font-size: 0.875rem;\n  line-height: 2.25rem;\n  font-weight: 500;\n  letter-spacing: 0.0892857143em;\n  text-decoration: none;\n  text-transform: uppercase;\n  padding: 0 8px 0 8px;\n  display: inline-flex;\n  position: relative;\n  align-items: center;\n  justify-content: center;\n  box-sizing: border-box;\n  min-width: 64px;\n  height: 36px;\n  border: none;\n  outline: none;\n  /* @alternate */\n  line-height: inherit;\n  user-select: none;\n  -webkit-appearance: none;\n  overflow: hidden;\n  vertical-align: middle;\n  border-radius: 4px;\n}\n.mdc-button::-moz-focus-inner {\n  padding: 0;\n  border: 0;\n}\n.mdc-button:active {\n  outline: none;\n}\n.mdc-button:hover {\n  cursor: pointer;\n}\n.mdc-button:disabled {\n  background-color: transparent;\n  color: rgba(0, 0, 0, 0.37);\n  cursor: default;\n  pointer-events: none;\n}\n.mdc-button.mdc-button--dense {\n  border-radius: 4px;\n}\n.mdc-button:not(:disabled) {\n  background-color: transparent;\n}\n.mdc-button .mdc-button__icon {\n  /* @noflip */\n  margin-left: 0;\n  /* @noflip */\n  margin-right: 8px;\n  display: inline-block;\n  width: 18px;\n  height: 18px;\n  font-size: 18px;\n  vertical-align: top;\n}\n[dir=rtl] .mdc-button .mdc-button__icon, .mdc-button .mdc-button__icon[dir=rtl] {\n  /* @noflip */\n  margin-left: 8px;\n  /* @noflip */\n  margin-right: 0;\n}\n.mdc-button:not(:disabled) {\n  color: #6200ee;\n  /* @alternate */\n  color: var(--mdc-theme-primary, #6200ee);\n}\n\n.mdc-button__label + .mdc-button__icon {\n  /* @noflip */\n  margin-left: 8px;\n  /* @noflip */\n  margin-right: 0;\n}\n[dir=rtl] .mdc-button__label + .mdc-button__icon, .mdc-button__label + .mdc-button__icon[dir=rtl] {\n  /* @noflip */\n  margin-left: 0;\n  /* @noflip */\n  margin-right: 8px;\n}\n\nsvg.mdc-button__icon {\n  fill: currentColor;\n}\n\n.mdc-button--raised .mdc-button__icon,\n.mdc-button--unelevated .mdc-button__icon,\n.mdc-button--outlined .mdc-button__icon {\n  /* @noflip */\n  margin-left: -4px;\n  /* @noflip */\n  margin-right: 8px;\n}\n[dir=rtl] .mdc-button--raised .mdc-button__icon, .mdc-button--raised .mdc-button__icon[dir=rtl],\n[dir=rtl] .mdc-button--unelevated .mdc-button__icon,\n.mdc-button--unelevated .mdc-button__icon[dir=rtl],\n[dir=rtl] .mdc-button--outlined .mdc-button__icon,\n.mdc-button--outlined .mdc-button__icon[dir=rtl] {\n  /* @noflip */\n  margin-left: 8px;\n  /* @noflip */\n  margin-right: -4px;\n}\n.mdc-button--raised .mdc-button__label + .mdc-button__icon,\n.mdc-button--unelevated .mdc-button__label + .mdc-button__icon,\n.mdc-button--outlined .mdc-button__label + .mdc-button__icon {\n  /* @noflip */\n  margin-left: 8px;\n  /* @noflip */\n  margin-right: -4px;\n}\n[dir=rtl] .mdc-button--raised .mdc-button__label + .mdc-button__icon, .mdc-button--raised .mdc-button__label + .mdc-button__icon[dir=rtl],\n[dir=rtl] .mdc-button--unelevated .mdc-button__label + .mdc-button__icon,\n.mdc-button--unelevated .mdc-button__label + .mdc-button__icon[dir=rtl],\n[dir=rtl] .mdc-button--outlined .mdc-button__label + .mdc-button__icon,\n.mdc-button--outlined .mdc-button__label + .mdc-button__icon[dir=rtl] {\n  /* @noflip */\n  margin-left: -4px;\n  /* @noflip */\n  margin-right: 8px;\n}\n\n.mdc-button--raised,\n.mdc-button--unelevated {\n  padding: 0 16px 0 16px;\n}\n.mdc-button--raised:disabled,\n.mdc-button--unelevated:disabled {\n  background-color: rgba(0, 0, 0, 0.12);\n  color: rgba(0, 0, 0, 0.37);\n}\n.mdc-button--raised:not(:disabled),\n.mdc-button--unelevated:not(:disabled) {\n  background-color: #6200ee;\n}\n@supports not (-ms-ime-align: auto) {\n  .mdc-button--raised:not(:disabled),\n.mdc-button--unelevated:not(:disabled) {\n    /* @alternate */\n    background-color: var(--mdc-theme-primary, #6200ee);\n  }\n}\n.mdc-button--raised:not(:disabled),\n.mdc-button--unelevated:not(:disabled) {\n  color: #fff;\n  /* @alternate */\n  color: var(--mdc-theme-on-primary, #fff);\n}\n\n.mdc-button--raised {\n  box-shadow: 0px 3px 1px -2px rgba(0, 0, 0, 0.2), 0px 2px 2px 0px rgba(0, 0, 0, 0.14), 0px 1px 5px 0px rgba(0, 0, 0, 0.12);\n  transition: box-shadow 280ms cubic-bezier(0.4, 0, 0.2, 1);\n}\n.mdc-button--raised:hover, .mdc-button--raised:focus {\n  box-shadow: 0px 2px 4px -1px rgba(0, 0, 0, 0.2), 0px 4px 5px 0px rgba(0, 0, 0, 0.14), 0px 1px 10px 0px rgba(0, 0, 0, 0.12);\n}\n.mdc-button--raised:active {\n  box-shadow: 0px 5px 5px -3px rgba(0, 0, 0, 0.2), 0px 8px 10px 1px rgba(0, 0, 0, 0.14), 0px 3px 14px 2px rgba(0, 0, 0, 0.12);\n}\n.mdc-button--raised:disabled {\n  box-shadow: 0px 0px 0px 0px rgba(0, 0, 0, 0.2), 0px 0px 0px 0px rgba(0, 0, 0, 0.14), 0px 0px 0px 0px rgba(0, 0, 0, 0.12);\n}\n\n.mdc-button--outlined {\n  border-style: solid;\n  padding: 0 15px 0 15px;\n  border-width: 1px;\n}\n.mdc-button--outlined:disabled {\n  border-color: rgba(0, 0, 0, 0.37);\n}\n.mdc-button--outlined:not(:disabled) {\n  border-color: #6200ee;\n  /* @alternate */\n  border-color: var(--mdc-theme-primary, #6200ee);\n}\n\n.mdc-button--dense {\n  height: 32px;\n  font-size: 0.8125rem;\n}\n\n.mdc-button {\n  --mdc-ripple-fg-size: 0;\n  --mdc-ripple-left: 0;\n  --mdc-ripple-top: 0;\n  --mdc-ripple-fg-scale: 1;\n  --mdc-ripple-fg-translate-end: 0;\n  --mdc-ripple-fg-translate-start: 0;\n  -webkit-tap-highlight-color: rgba(0, 0, 0, 0);\n}\n.mdc-button::before, .mdc-button::after {\n  position: absolute;\n  border-radius: 50%;\n  opacity: 0;\n  pointer-events: none;\n  content: \"\";\n}\n.mdc-button::before {\n  transition: opacity 15ms linear, background-color 15ms linear;\n  z-index: 1;\n}\n.mdc-button.mdc-ripple-upgraded::before {\n  transform: scale(var(--mdc-ripple-fg-scale, 1));\n}\n.mdc-button.mdc-ripple-upgraded::after {\n  top: 0;\n  /* @noflip */\n  left: 0;\n  transform: scale(0);\n  transform-origin: center center;\n}\n.mdc-button.mdc-ripple-upgraded--unbounded::after {\n  top: var(--mdc-ripple-top, 0);\n  /* @noflip */\n  left: var(--mdc-ripple-left, 0);\n}\n.mdc-button.mdc-ripple-upgraded--foreground-activation::after {\n  animation: mdc-ripple-fg-radius-in 225ms forwards, mdc-ripple-fg-opacity-in 75ms forwards;\n}\n.mdc-button.mdc-ripple-upgraded--foreground-deactivation::after {\n  animation: mdc-ripple-fg-opacity-out 150ms;\n  transform: translate(var(--mdc-ripple-fg-translate-end, 0)) scale(var(--mdc-ripple-fg-scale, 1));\n}\n.mdc-button::before, .mdc-button::after {\n  top: calc(50% - 100%);\n  /* @noflip */\n  left: calc(50% - 100%);\n  width: 200%;\n  height: 200%;\n}\n.mdc-button.mdc-ripple-upgraded::after {\n  width: var(--mdc-ripple-fg-size, 100%);\n  height: var(--mdc-ripple-fg-size, 100%);\n}\n.mdc-button::before, .mdc-button::after {\n  background-color: #6200ee;\n}\n@supports not (-ms-ime-align: auto) {\n  .mdc-button::before, .mdc-button::after {\n    /* @alternate */\n    background-color: var(--mdc-theme-primary, #6200ee);\n  }\n}\n.mdc-button:hover::before {\n  opacity: 0.04;\n}\n.mdc-button:not(.mdc-ripple-upgraded):focus::before, .mdc-button.mdc-ripple-upgraded--background-focused::before {\n  transition-duration: 75ms;\n  opacity: 0.12;\n}\n.mdc-button:not(.mdc-ripple-upgraded)::after {\n  transition: opacity 150ms linear;\n}\n.mdc-button:not(.mdc-ripple-upgraded):active::after {\n  transition-duration: 75ms;\n  opacity: 0.12;\n}\n.mdc-button.mdc-ripple-upgraded {\n  --mdc-ripple-fg-opacity: 0.12;\n}\n\n.mdc-button--raised::before, .mdc-button--raised::after,\n.mdc-button--unelevated::before,\n.mdc-button--unelevated::after {\n  background-color: #fff;\n}\n@supports not (-ms-ime-align: auto) {\n  .mdc-button--raised::before, .mdc-button--raised::after,\n.mdc-button--unelevated::before,\n.mdc-button--unelevated::after {\n    /* @alternate */\n    background-color: var(--mdc-theme-on-primary, #fff);\n  }\n}\n.mdc-button--raised:hover::before,\n.mdc-button--unelevated:hover::before {\n  opacity: 0.08;\n}\n.mdc-button--raised:not(.mdc-ripple-upgraded):focus::before, .mdc-button--raised.mdc-ripple-upgraded--background-focused::before,\n.mdc-button--unelevated:not(.mdc-ripple-upgraded):focus::before,\n.mdc-button--unelevated.mdc-ripple-upgraded--background-focused::before {\n  transition-duration: 75ms;\n  opacity: 0.24;\n}\n.mdc-button--raised:not(.mdc-ripple-upgraded)::after,\n.mdc-button--unelevated:not(.mdc-ripple-upgraded)::after {\n  transition: opacity 150ms linear;\n}\n.mdc-button--raised:not(.mdc-ripple-upgraded):active::after,\n.mdc-button--unelevated:not(.mdc-ripple-upgraded):active::after {\n  transition-duration: 75ms;\n  opacity: 0.24;\n}\n.mdc-button--raised.mdc-ripple-upgraded,\n.mdc-button--unelevated.mdc-ripple-upgraded {\n  --mdc-ripple-fg-opacity: 0.24;\n}\n\n.mdc-ripple-surface {\n  --mdc-ripple-fg-size: 0;\n  --mdc-ripple-left: 0;\n  --mdc-ripple-top: 0;\n  --mdc-ripple-fg-scale: 1;\n  --mdc-ripple-fg-translate-end: 0;\n  --mdc-ripple-fg-translate-start: 0;\n  -webkit-tap-highlight-color: rgba(0, 0, 0, 0);\n  position: relative;\n  outline: none;\n  overflow: hidden;\n}\n.mdc-ripple-surface::before, .mdc-ripple-surface::after {\n  position: absolute;\n  border-radius: 50%;\n  opacity: 0;\n  pointer-events: none;\n  content: \"\";\n}\n.mdc-ripple-surface::before {\n  transition: opacity 15ms linear, background-color 15ms linear;\n  z-index: 1;\n}\n.mdc-ripple-surface.mdc-ripple-upgraded::before {\n  transform: scale(var(--mdc-ripple-fg-scale, 1));\n}\n.mdc-ripple-surface.mdc-ripple-upgraded::after {\n  top: 0;\n  /* @noflip */\n  left: 0;\n  transform: scale(0);\n  transform-origin: center center;\n}\n.mdc-ripple-surface.mdc-ripple-upgraded--unbounded::after {\n  top: var(--mdc-ripple-top, 0);\n  /* @noflip */\n  left: var(--mdc-ripple-left, 0);\n}\n.mdc-ripple-surface.mdc-ripple-upgraded--foreground-activation::after {\n  animation: mdc-ripple-fg-radius-in 225ms forwards, mdc-ripple-fg-opacity-in 75ms forwards;\n}\n.mdc-ripple-surface.mdc-ripple-upgraded--foreground-deactivation::after {\n  animation: mdc-ripple-fg-opacity-out 150ms;\n  transform: translate(var(--mdc-ripple-fg-translate-end, 0)) scale(var(--mdc-ripple-fg-scale, 1));\n}\n.mdc-ripple-surface::before, .mdc-ripple-surface::after {\n  background-color: #000;\n}\n.mdc-ripple-surface:hover::before {\n  opacity: 0.04;\n}\n.mdc-ripple-surface:not(.mdc-ripple-upgraded):focus::before, .mdc-ripple-surface.mdc-ripple-upgraded--background-focused::before {\n  transition-duration: 75ms;\n  opacity: 0.12;\n}\n.mdc-ripple-surface:not(.mdc-ripple-upgraded)::after {\n  transition: opacity 150ms linear;\n}\n.mdc-ripple-surface:not(.mdc-ripple-upgraded):active::after {\n  transition-duration: 75ms;\n  opacity: 0.12;\n}\n.mdc-ripple-surface.mdc-ripple-upgraded {\n  --mdc-ripple-fg-opacity: 0.12;\n}\n.mdc-ripple-surface::before, .mdc-ripple-surface::after {\n  top: calc(50% - 100%);\n  /* @noflip */\n  left: calc(50% - 100%);\n  width: 200%;\n  height: 200%;\n}\n.mdc-ripple-surface.mdc-ripple-upgraded::after {\n  width: var(--mdc-ripple-fg-size, 100%);\n  height: var(--mdc-ripple-fg-size, 100%);\n}\n.mdc-ripple-surface[data-mdc-ripple-is-unbounded] {\n  overflow: visible;\n}\n.mdc-ripple-surface[data-mdc-ripple-is-unbounded]::before, .mdc-ripple-surface[data-mdc-ripple-is-unbounded]::after {\n  top: calc(50% - 50%);\n  /* @noflip */\n  left: calc(50% - 50%);\n  width: 100%;\n  height: 100%;\n}\n.mdc-ripple-surface[data-mdc-ripple-is-unbounded].mdc-ripple-upgraded::before, .mdc-ripple-surface[data-mdc-ripple-is-unbounded].mdc-ripple-upgraded::after {\n  top: var(--mdc-ripple-top, calc(50% - 50%));\n  /* @noflip */\n  left: var(--mdc-ripple-left, calc(50% - 50%));\n  width: var(--mdc-ripple-fg-size, 100%);\n  height: var(--mdc-ripple-fg-size, 100%);\n}\n.mdc-ripple-surface[data-mdc-ripple-is-unbounded].mdc-ripple-upgraded::after {\n  width: var(--mdc-ripple-fg-size, 100%);\n  height: var(--mdc-ripple-fg-size, 100%);\n}\n.mdc-ripple-surface--primary::before, .mdc-ripple-surface--primary::after {\n  background-color: #6200ee;\n}\n@supports not (-ms-ime-align: auto) {\n  .mdc-ripple-surface--primary::before, .mdc-ripple-surface--primary::after {\n    /* @alternate */\n    background-color: var(--mdc-theme-primary, #6200ee);\n  }\n}\n.mdc-ripple-surface--primary:hover::before {\n  opacity: 0.04;\n}\n.mdc-ripple-surface--primary:not(.mdc-ripple-upgraded):focus::before, .mdc-ripple-surface--primary.mdc-ripple-upgraded--background-focused::before {\n  transition-duration: 75ms;\n  opacity: 0.12;\n}\n.mdc-ripple-surface--primary:not(.mdc-ripple-upgraded)::after {\n  transition: opacity 150ms linear;\n}\n.mdc-ripple-surface--primary:not(.mdc-ripple-upgraded):active::after {\n  transition-duration: 75ms;\n  opacity: 0.12;\n}\n.mdc-ripple-surface--primary.mdc-ripple-upgraded {\n  --mdc-ripple-fg-opacity: 0.12;\n}\n.mdc-ripple-surface--accent::before, .mdc-ripple-surface--accent::after {\n  background-color: #018786;\n}\n@supports not (-ms-ime-align: auto) {\n  .mdc-ripple-surface--accent::before, .mdc-ripple-surface--accent::after {\n    /* @alternate */\n    background-color: var(--mdc-theme-secondary, #018786);\n  }\n}\n.mdc-ripple-surface--accent:hover::before {\n  opacity: 0.04;\n}\n.mdc-ripple-surface--accent:not(.mdc-ripple-upgraded):focus::before, .mdc-ripple-surface--accent.mdc-ripple-upgraded--background-focused::before {\n  transition-duration: 75ms;\n  opacity: 0.12;\n}\n.mdc-ripple-surface--accent:not(.mdc-ripple-upgraded)::after {\n  transition: opacity 150ms linear;\n}\n.mdc-ripple-surface--accent:not(.mdc-ripple-upgraded):active::after {\n  transition-duration: 75ms;\n  opacity: 0.12;\n}\n.mdc-ripple-surface--accent.mdc-ripple-upgraded {\n  --mdc-ripple-fg-opacity: 0.12;\n}\n\n.smui-button--color-secondary:not(:disabled) {\n  color: #018786;\n  /* @alternate */\n  color: var(--mdc-theme-secondary, #018786);\n}\n.smui-button--color-secondary.mdc-button--raised:not(:disabled), .smui-button--color-secondary.mdc-button--unelevated:not(:disabled) {\n  background-color: #018786;\n}\n@supports not (-ms-ime-align: auto) {\n  .smui-button--color-secondary.mdc-button--raised:not(:disabled), .smui-button--color-secondary.mdc-button--unelevated:not(:disabled) {\n    /* @alternate */\n    background-color: var(--mdc-theme-secondary, #018786);\n  }\n}\n.smui-button--color-secondary.mdc-button--raised:not(:disabled), .smui-button--color-secondary.mdc-button--unelevated:not(:disabled) {\n  color: #fff;\n  /* @alternate */\n  color: var(--mdc-theme-on-secondary, #fff);\n}\n.smui-button--color-secondary.mdc-button--outlined:not(:disabled) {\n  border-color: #018786;\n  /* @alternate */\n  border-color: var(--mdc-theme-secondary, #018786);\n}\n\n.smui-button--color-secondary::before, .smui-button--color-secondary::after {\n  background-color: #018786;\n}\n@supports not (-ms-ime-align: auto) {\n  .smui-button--color-secondary::before, .smui-button--color-secondary::after {\n    /* @alternate */\n    background-color: var(--mdc-theme-secondary, #018786);\n  }\n}\n.smui-button--color-secondary:hover::before {\n  opacity: 0.04;\n}\n.smui-button--color-secondary:not(.mdc-ripple-upgraded):focus::before, .smui-button--color-secondary.mdc-ripple-upgraded--background-focused::before {\n  transition-duration: 75ms;\n  opacity: 0.12;\n}\n.smui-button--color-secondary:not(.mdc-ripple-upgraded)::after {\n  transition: opacity 150ms linear;\n}\n.smui-button--color-secondary:not(.mdc-ripple-upgraded):active::after {\n  transition-duration: 75ms;\n  opacity: 0.12;\n}\n.smui-button--color-secondary.mdc-ripple-upgraded {\n  --mdc-ripple-fg-opacity: 0.12;\n}\n.smui-button--color-secondary.mdc-button--raised::before, .smui-button--color-secondary.mdc-button--raised::after, .smui-button--color-secondary.mdc-button--unelevated::before, .smui-button--color-secondary.mdc-button--unelevated::after {\n  background-color: #fff;\n}\n@supports not (-ms-ime-align: auto) {\n  .smui-button--color-secondary.mdc-button--raised::before, .smui-button--color-secondary.mdc-button--raised::after, .smui-button--color-secondary.mdc-button--unelevated::before, .smui-button--color-secondary.mdc-button--unelevated::after {\n    /* @alternate */\n    background-color: var(--mdc-theme-on-secondary, #fff);\n  }\n}\n.smui-button--color-secondary.mdc-button--raised:hover::before, .smui-button--color-secondary.mdc-button--unelevated:hover::before {\n  opacity: 0.08;\n}\n.smui-button--color-secondary.mdc-button--raised:not(.mdc-ripple-upgraded):focus::before, .smui-button--color-secondary.mdc-button--raised.mdc-ripple-upgraded--background-focused::before, .smui-button--color-secondary.mdc-button--unelevated:not(.mdc-ripple-upgraded):focus::before, .smui-button--color-secondary.mdc-button--unelevated.mdc-ripple-upgraded--background-focused::before {\n  transition-duration: 75ms;\n  opacity: 0.24;\n}\n.smui-button--color-secondary.mdc-button--raised:not(.mdc-ripple-upgraded)::after, .smui-button--color-secondary.mdc-button--unelevated:not(.mdc-ripple-upgraded)::after {\n  transition: opacity 150ms linear;\n}\n.smui-button--color-secondary.mdc-button--raised:not(.mdc-ripple-upgraded):active::after, .smui-button--color-secondary.mdc-button--unelevated:not(.mdc-ripple-upgraded):active::after {\n  transition-duration: 75ms;\n  opacity: 0.24;\n}\n.smui-button--color-secondary.mdc-button--raised.mdc-ripple-upgraded, .smui-button--color-secondary.mdc-button--unelevated.mdc-ripple-upgraded {\n  --mdc-ripple-fg-opacity: 0.24;\n}\n\n.smui-button__group {\n  display: inline-flex;\n}\n.smui-button__group > .mdc-button, .smui-button__group > .smui-button__group-item > .mdc-button {\n  margin-left: 0;\n  margin-right: 0;\n}\n.smui-button__group > .mdc-button:not(:last-child), .smui-button__group > .smui-button__group-item:not(:last-child) > .mdc-button {\n  border-top-right-radius: 0;\n  border-bottom-right-radius: 0;\n}\n.smui-button__group > .mdc-button:not(:first-child), .smui-button__group > .smui-button__group-item:not(:first-child) > .mdc-button {\n  border-top-left-radius: 0;\n  border-bottom-left-radius: 0;\n}\n.smui-button__group.smui-button__group--raised {\n  box-shadow: 0px 3px 1px -2px rgba(0, 0, 0, 0.2), 0px 2px 2px 0px rgba(0, 0, 0, 0.14), 0px 1px 5px 0px rgba(0, 0, 0, 0.12);\n}\n.smui-button__group > .mdc-button--raised, .smui-button__group > .smui-button__group-item > .mdc-button--raised {\n  border-radius: 4px;\n  box-shadow: 0px 0px 0px 0px rgba(0, 0, 0, 0.2), 0px 0px 0px 0px rgba(0, 0, 0, 0.14), 0px 0px 0px 0px rgba(0, 0, 0, 0.12);\n}\n.smui-button__group > .mdc-button--raised.mdc-button--dense, .smui-button__group > .smui-button__group-item > .mdc-button--raised.mdc-button--dense {\n  border-radius: 4px;\n}\n.smui-button__group > .mdc-button--raised:hover, .smui-button__group > .mdc-button--raised:focus, .smui-button__group > .smui-button__group-item > .mdc-button--raised:hover, .smui-button__group > .smui-button__group-item > .mdc-button--raised:focus {\n  box-shadow: 0px 0px 0px 0px rgba(0, 0, 0, 0.2), 0px 0px 0px 0px rgba(0, 0, 0, 0.14), 0px 0px 0px 0px rgba(0, 0, 0, 0.12);\n}\n.smui-button__group > .mdc-button--raised:active, .smui-button__group > .smui-button__group-item > .mdc-button--raised:active {\n  box-shadow: 0px 0px 0px 0px rgba(0, 0, 0, 0.2), 0px 0px 0px 0px rgba(0, 0, 0, 0.14), 0px 0px 0px 0px rgba(0, 0, 0, 0.12);\n}\n.smui-button__group > .mdc-button--raised:disabled, .smui-button__group > .smui-button__group-item > .mdc-button--raised:disabled {\n  box-shadow: 0px 0px 0px 0px rgba(0, 0, 0, 0.2), 0px 0px 0px 0px rgba(0, 0, 0, 0.14), 0px 0px 0px 0px rgba(0, 0, 0, 0.12);\n}\n.smui-button__group > .mdc-button--outlined:not(:last-child), .smui-button__group > .smui-button__group-item:not(:last-child) > .mdc-button--outlined {\n  border-right-width: 0;\n}\n\n.mdc-icon-button {\n  width: 48px;\n  height: 48px;\n  padding: 12px;\n  font-size: 24px;\n  display: inline-block;\n  position: relative;\n  box-sizing: border-box;\n  border: none;\n  outline: none;\n  background-color: transparent;\n  fill: currentColor;\n  color: inherit;\n  text-decoration: none;\n  cursor: pointer;\n  user-select: none;\n}\n.mdc-icon-button svg,\n.mdc-icon-button img {\n  width: 24px;\n  height: 24px;\n}\n.mdc-icon-button:disabled {\n  color: rgba(0, 0, 0, 0.38);\n  /* @alternate */\n  color: var(--mdc-theme-text-disabled-on-light, rgba(0, 0, 0, 0.38));\n  cursor: default;\n  pointer-events: none;\n}\n\n.mdc-icon-button__icon {\n  display: inline-block;\n}\n.mdc-icon-button__icon.mdc-icon-button__icon--on {\n  display: none;\n}\n\n.mdc-icon-button--on .mdc-icon-button__icon {\n  display: none;\n}\n.mdc-icon-button--on .mdc-icon-button__icon.mdc-icon-button__icon--on {\n  display: inline-block;\n}\n\n.mdc-icon-button {\n  --mdc-ripple-fg-size: 0;\n  --mdc-ripple-left: 0;\n  --mdc-ripple-top: 0;\n  --mdc-ripple-fg-scale: 1;\n  --mdc-ripple-fg-translate-end: 0;\n  --mdc-ripple-fg-translate-start: 0;\n  -webkit-tap-highlight-color: rgba(0, 0, 0, 0);\n}\n.mdc-icon-button::before, .mdc-icon-button::after {\n  position: absolute;\n  border-radius: 50%;\n  opacity: 0;\n  pointer-events: none;\n  content: \"\";\n}\n.mdc-icon-button::before {\n  transition: opacity 15ms linear, background-color 15ms linear;\n  z-index: 1;\n}\n.mdc-icon-button.mdc-ripple-upgraded::before {\n  transform: scale(var(--mdc-ripple-fg-scale, 1));\n}\n.mdc-icon-button.mdc-ripple-upgraded::after {\n  top: 0;\n  /* @noflip */\n  left: 0;\n  transform: scale(0);\n  transform-origin: center center;\n}\n.mdc-icon-button.mdc-ripple-upgraded--unbounded::after {\n  top: var(--mdc-ripple-top, 0);\n  /* @noflip */\n  left: var(--mdc-ripple-left, 0);\n}\n.mdc-icon-button.mdc-ripple-upgraded--foreground-activation::after {\n  animation: mdc-ripple-fg-radius-in 225ms forwards, mdc-ripple-fg-opacity-in 75ms forwards;\n}\n.mdc-icon-button.mdc-ripple-upgraded--foreground-deactivation::after {\n  animation: mdc-ripple-fg-opacity-out 150ms;\n  transform: translate(var(--mdc-ripple-fg-translate-end, 0)) scale(var(--mdc-ripple-fg-scale, 1));\n}\n.mdc-icon-button::before, .mdc-icon-button::after {\n  top: calc(50% - 50%);\n  /* @noflip */\n  left: calc(50% - 50%);\n  width: 100%;\n  height: 100%;\n}\n.mdc-icon-button.mdc-ripple-upgraded::before, .mdc-icon-button.mdc-ripple-upgraded::after {\n  top: var(--mdc-ripple-top, calc(50% - 50%));\n  /* @noflip */\n  left: var(--mdc-ripple-left, calc(50% - 50%));\n  width: var(--mdc-ripple-fg-size, 100%);\n  height: var(--mdc-ripple-fg-size, 100%);\n}\n.mdc-icon-button.mdc-ripple-upgraded::after {\n  width: var(--mdc-ripple-fg-size, 100%);\n  height: var(--mdc-ripple-fg-size, 100%);\n}\n.mdc-icon-button::before, .mdc-icon-button::after {\n  background-color: #000;\n}\n.mdc-icon-button:hover::before {\n  opacity: 0.04;\n}\n.mdc-icon-button:not(.mdc-ripple-upgraded):focus::before, .mdc-icon-button.mdc-ripple-upgraded--background-focused::before {\n  transition-duration: 75ms;\n  opacity: 0.12;\n}\n.mdc-icon-button:not(.mdc-ripple-upgraded)::after {\n  transition: opacity 150ms linear;\n}\n.mdc-icon-button:not(.mdc-ripple-upgraded):active::after {\n  transition-duration: 75ms;\n  opacity: 0.12;\n}\n.mdc-icon-button.mdc-ripple-upgraded {\n  --mdc-ripple-fg-opacity: 0.12;\n}\n\n.mdc-ripple-surface {\n  --mdc-ripple-fg-size: 0;\n  --mdc-ripple-left: 0;\n  --mdc-ripple-top: 0;\n  --mdc-ripple-fg-scale: 1;\n  --mdc-ripple-fg-translate-end: 0;\n  --mdc-ripple-fg-translate-start: 0;\n  -webkit-tap-highlight-color: rgba(0, 0, 0, 0);\n  position: relative;\n  outline: none;\n  overflow: hidden;\n}\n.mdc-ripple-surface::before, .mdc-ripple-surface::after {\n  position: absolute;\n  border-radius: 50%;\n  opacity: 0;\n  pointer-events: none;\n  content: \"\";\n}\n.mdc-ripple-surface::before {\n  transition: opacity 15ms linear, background-color 15ms linear;\n  z-index: 1;\n}\n.mdc-ripple-surface.mdc-ripple-upgraded::before {\n  transform: scale(var(--mdc-ripple-fg-scale, 1));\n}\n.mdc-ripple-surface.mdc-ripple-upgraded::after {\n  top: 0;\n  /* @noflip */\n  left: 0;\n  transform: scale(0);\n  transform-origin: center center;\n}\n.mdc-ripple-surface.mdc-ripple-upgraded--unbounded::after {\n  top: var(--mdc-ripple-top, 0);\n  /* @noflip */\n  left: var(--mdc-ripple-left, 0);\n}\n.mdc-ripple-surface.mdc-ripple-upgraded--foreground-activation::after {\n  animation: mdc-ripple-fg-radius-in 225ms forwards, mdc-ripple-fg-opacity-in 75ms forwards;\n}\n.mdc-ripple-surface.mdc-ripple-upgraded--foreground-deactivation::after {\n  animation: mdc-ripple-fg-opacity-out 150ms;\n  transform: translate(var(--mdc-ripple-fg-translate-end, 0)) scale(var(--mdc-ripple-fg-scale, 1));\n}\n.mdc-ripple-surface::before, .mdc-ripple-surface::after {\n  background-color: #000;\n}\n.mdc-ripple-surface:hover::before {\n  opacity: 0.04;\n}\n.mdc-ripple-surface:not(.mdc-ripple-upgraded):focus::before, .mdc-ripple-surface.mdc-ripple-upgraded--background-focused::before {\n  transition-duration: 75ms;\n  opacity: 0.12;\n}\n.mdc-ripple-surface:not(.mdc-ripple-upgraded)::after {\n  transition: opacity 150ms linear;\n}\n.mdc-ripple-surface:not(.mdc-ripple-upgraded):active::after {\n  transition-duration: 75ms;\n  opacity: 0.12;\n}\n.mdc-ripple-surface.mdc-ripple-upgraded {\n  --mdc-ripple-fg-opacity: 0.12;\n}\n.mdc-ripple-surface::before, .mdc-ripple-surface::after {\n  top: calc(50% - 100%);\n  /* @noflip */\n  left: calc(50% - 100%);\n  width: 200%;\n  height: 200%;\n}\n.mdc-ripple-surface.mdc-ripple-upgraded::after {\n  width: var(--mdc-ripple-fg-size, 100%);\n  height: var(--mdc-ripple-fg-size, 100%);\n}\n.mdc-ripple-surface[data-mdc-ripple-is-unbounded] {\n  overflow: visible;\n}\n.mdc-ripple-surface[data-mdc-ripple-is-unbounded]::before, .mdc-ripple-surface[data-mdc-ripple-is-unbounded]::after {\n  top: calc(50% - 50%);\n  /* @noflip */\n  left: calc(50% - 50%);\n  width: 100%;\n  height: 100%;\n}\n.mdc-ripple-surface[data-mdc-ripple-is-unbounded].mdc-ripple-upgraded::before, .mdc-ripple-surface[data-mdc-ripple-is-unbounded].mdc-ripple-upgraded::after {\n  top: var(--mdc-ripple-top, calc(50% - 50%));\n  /* @noflip */\n  left: var(--mdc-ripple-left, calc(50% - 50%));\n  width: var(--mdc-ripple-fg-size, 100%);\n  height: var(--mdc-ripple-fg-size, 100%);\n}\n.mdc-ripple-surface[data-mdc-ripple-is-unbounded].mdc-ripple-upgraded::after {\n  width: var(--mdc-ripple-fg-size, 100%);\n  height: var(--mdc-ripple-fg-size, 100%);\n}\n.mdc-ripple-surface--primary::before, .mdc-ripple-surface--primary::after {\n  background-color: #6200ee;\n}\n@supports not (-ms-ime-align: auto) {\n  .mdc-ripple-surface--primary::before, .mdc-ripple-surface--primary::after {\n    /* @alternate */\n    background-color: var(--mdc-theme-primary, #6200ee);\n  }\n}\n.mdc-ripple-surface--primary:hover::before {\n  opacity: 0.04;\n}\n.mdc-ripple-surface--primary:not(.mdc-ripple-upgraded):focus::before, .mdc-ripple-surface--primary.mdc-ripple-upgraded--background-focused::before {\n  transition-duration: 75ms;\n  opacity: 0.12;\n}\n.mdc-ripple-surface--primary:not(.mdc-ripple-upgraded)::after {\n  transition: opacity 150ms linear;\n}\n.mdc-ripple-surface--primary:not(.mdc-ripple-upgraded):active::after {\n  transition-duration: 75ms;\n  opacity: 0.12;\n}\n.mdc-ripple-surface--primary.mdc-ripple-upgraded {\n  --mdc-ripple-fg-opacity: 0.12;\n}\n.mdc-ripple-surface--accent::before, .mdc-ripple-surface--accent::after {\n  background-color: #018786;\n}\n@supports not (-ms-ime-align: auto) {\n  .mdc-ripple-surface--accent::before, .mdc-ripple-surface--accent::after {\n    /* @alternate */\n    background-color: var(--mdc-theme-secondary, #018786);\n  }\n}\n.mdc-ripple-surface--accent:hover::before {\n  opacity: 0.04;\n}\n.mdc-ripple-surface--accent:not(.mdc-ripple-upgraded):focus::before, .mdc-ripple-surface--accent.mdc-ripple-upgraded--background-focused::before {\n  transition-duration: 75ms;\n  opacity: 0.12;\n}\n.mdc-ripple-surface--accent:not(.mdc-ripple-upgraded)::after {\n  transition: opacity 150ms linear;\n}\n.mdc-ripple-surface--accent:not(.mdc-ripple-upgraded):active::after {\n  transition-duration: 75ms;\n  opacity: 0.12;\n}\n.mdc-ripple-surface--accent.mdc-ripple-upgraded {\n  --mdc-ripple-fg-opacity: 0.12;\n}\n\n.mdc-ripple-surface {\n  --mdc-ripple-fg-size: 0;\n  --mdc-ripple-left: 0;\n  --mdc-ripple-top: 0;\n  --mdc-ripple-fg-scale: 1;\n  --mdc-ripple-fg-translate-end: 0;\n  --mdc-ripple-fg-translate-start: 0;\n  -webkit-tap-highlight-color: rgba(0, 0, 0, 0);\n  position: relative;\n  outline: none;\n  overflow: hidden;\n}\n.mdc-ripple-surface::before, .mdc-ripple-surface::after {\n  position: absolute;\n  border-radius: 50%;\n  opacity: 0;\n  pointer-events: none;\n  content: \"\";\n}\n.mdc-ripple-surface::before {\n  transition: opacity 15ms linear, background-color 15ms linear;\n  z-index: 1;\n}\n.mdc-ripple-surface.mdc-ripple-upgraded::before {\n  transform: scale(var(--mdc-ripple-fg-scale, 1));\n}\n.mdc-ripple-surface.mdc-ripple-upgraded::after {\n  top: 0;\n  /* @noflip */\n  left: 0;\n  transform: scale(0);\n  transform-origin: center center;\n}\n.mdc-ripple-surface.mdc-ripple-upgraded--unbounded::after {\n  top: var(--mdc-ripple-top, 0);\n  /* @noflip */\n  left: var(--mdc-ripple-left, 0);\n}\n.mdc-ripple-surface.mdc-ripple-upgraded--foreground-activation::after {\n  animation: mdc-ripple-fg-radius-in 225ms forwards, mdc-ripple-fg-opacity-in 75ms forwards;\n}\n.mdc-ripple-surface.mdc-ripple-upgraded--foreground-deactivation::after {\n  animation: mdc-ripple-fg-opacity-out 150ms;\n  transform: translate(var(--mdc-ripple-fg-translate-end, 0)) scale(var(--mdc-ripple-fg-scale, 1));\n}\n.mdc-ripple-surface::before, .mdc-ripple-surface::after {\n  background-color: #000;\n}\n.mdc-ripple-surface:hover::before {\n  opacity: 0.04;\n}\n.mdc-ripple-surface:not(.mdc-ripple-upgraded):focus::before, .mdc-ripple-surface.mdc-ripple-upgraded--background-focused::before {\n  transition-duration: 75ms;\n  opacity: 0.12;\n}\n.mdc-ripple-surface:not(.mdc-ripple-upgraded)::after {\n  transition: opacity 150ms linear;\n}\n.mdc-ripple-surface:not(.mdc-ripple-upgraded):active::after {\n  transition-duration: 75ms;\n  opacity: 0.12;\n}\n.mdc-ripple-surface.mdc-ripple-upgraded {\n  --mdc-ripple-fg-opacity: 0.12;\n}\n.mdc-ripple-surface::before, .mdc-ripple-surface::after {\n  top: calc(50% - 100%);\n  /* @noflip */\n  left: calc(50% - 100%);\n  width: 200%;\n  height: 200%;\n}\n.mdc-ripple-surface.mdc-ripple-upgraded::after {\n  width: var(--mdc-ripple-fg-size, 100%);\n  height: var(--mdc-ripple-fg-size, 100%);\n}\n.mdc-ripple-surface[data-mdc-ripple-is-unbounded] {\n  overflow: visible;\n}\n.mdc-ripple-surface[data-mdc-ripple-is-unbounded]::before, .mdc-ripple-surface[data-mdc-ripple-is-unbounded]::after {\n  top: calc(50% - 50%);\n  /* @noflip */\n  left: calc(50% - 50%);\n  width: 100%;\n  height: 100%;\n}\n.mdc-ripple-surface[data-mdc-ripple-is-unbounded].mdc-ripple-upgraded::before, .mdc-ripple-surface[data-mdc-ripple-is-unbounded].mdc-ripple-upgraded::after {\n  top: var(--mdc-ripple-top, calc(50% - 50%));\n  /* @noflip */\n  left: var(--mdc-ripple-left, calc(50% - 50%));\n  width: var(--mdc-ripple-fg-size, 100%);\n  height: var(--mdc-ripple-fg-size, 100%);\n}\n.mdc-ripple-surface[data-mdc-ripple-is-unbounded].mdc-ripple-upgraded::after {\n  width: var(--mdc-ripple-fg-size, 100%);\n  height: var(--mdc-ripple-fg-size, 100%);\n}\n.mdc-ripple-surface--primary::before, .mdc-ripple-surface--primary::after {\n  background-color: #6200ee;\n}\n@supports not (-ms-ime-align: auto) {\n  .mdc-ripple-surface--primary::before, .mdc-ripple-surface--primary::after {\n    /* @alternate */\n    background-color: var(--mdc-theme-primary, #6200ee);\n  }\n}\n.mdc-ripple-surface--primary:hover::before {\n  opacity: 0.04;\n}\n.mdc-ripple-surface--primary:not(.mdc-ripple-upgraded):focus::before, .mdc-ripple-surface--primary.mdc-ripple-upgraded--background-focused::before {\n  transition-duration: 75ms;\n  opacity: 0.12;\n}\n.mdc-ripple-surface--primary:not(.mdc-ripple-upgraded)::after {\n  transition: opacity 150ms linear;\n}\n.mdc-ripple-surface--primary:not(.mdc-ripple-upgraded):active::after {\n  transition-duration: 75ms;\n  opacity: 0.12;\n}\n.mdc-ripple-surface--primary.mdc-ripple-upgraded {\n  --mdc-ripple-fg-opacity: 0.12;\n}\n.mdc-ripple-surface--accent::before, .mdc-ripple-surface--accent::after {\n  background-color: #018786;\n}\n@supports not (-ms-ime-align: auto) {\n  .mdc-ripple-surface--accent::before, .mdc-ripple-surface--accent::after {\n    /* @alternate */\n    background-color: var(--mdc-theme-secondary, #018786);\n  }\n}\n.mdc-ripple-surface--accent:hover::before {\n  opacity: 0.04;\n}\n.mdc-ripple-surface--accent:not(.mdc-ripple-upgraded):focus::before, .mdc-ripple-surface--accent.mdc-ripple-upgraded--background-focused::before {\n  transition-duration: 75ms;\n  opacity: 0.12;\n}\n.mdc-ripple-surface--accent:not(.mdc-ripple-upgraded)::after {\n  transition: opacity 150ms linear;\n}\n.mdc-ripple-surface--accent:not(.mdc-ripple-upgraded):active::after {\n  transition-duration: 75ms;\n  opacity: 0.12;\n}\n.mdc-ripple-surface--accent.mdc-ripple-upgraded {\n  --mdc-ripple-fg-opacity: 0.12;\n}\n\n.smui-card--padded, .smui-card__content, .smui-card__primary-action--padded {\n  padding: 16px;\n}\n";
    styleInject(css_248z);

    /**
     * @license
     * Copyright 2018 Google Inc.
     *
     * Permission is hereby granted, free of charge, to any person obtaining a copy
     * of this software and associated documentation files (the "Software"), to deal
     * in the Software without restriction, including without limitation the rights
     * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
     * copies of the Software, and to permit persons to whom the Software is
     * furnished to do so, subject to the following conditions:
     *
     * The above copyright notice and this permission notice shall be included in
     * all copies or substantial portions of the Software.
     *
     * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
     * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
     * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
     * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
     * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
     * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
     * THE SOFTWARE.
     */
    var cssClasses$1 = {
        ACTIVE: 'mdc-tab-indicator--active',
        FADE: 'mdc-tab-indicator--fade',
        NO_TRANSITION: 'mdc-tab-indicator--no-transition',
    };
    var strings$1 = {
        CONTENT_SELECTOR: '.mdc-tab-indicator__content',
    };

    /**
     * @license
     * Copyright 2018 Google Inc.
     *
     * Permission is hereby granted, free of charge, to any person obtaining a copy
     * of this software and associated documentation files (the "Software"), to deal
     * in the Software without restriction, including without limitation the rights
     * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
     * copies of the Software, and to permit persons to whom the Software is
     * furnished to do so, subject to the following conditions:
     *
     * The above copyright notice and this permission notice shall be included in
     * all copies or substantial portions of the Software.
     *
     * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
     * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
     * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
     * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
     * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
     * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
     * THE SOFTWARE.
     */
    var MDCTabIndicatorFoundation = /** @class */ (function (_super) {
        __extends(MDCTabIndicatorFoundation, _super);
        function MDCTabIndicatorFoundation(adapter) {
            return _super.call(this, __assign({}, MDCTabIndicatorFoundation.defaultAdapter, adapter)) || this;
        }
        Object.defineProperty(MDCTabIndicatorFoundation, "cssClasses", {
            get: function () {
                return cssClasses$1;
            },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(MDCTabIndicatorFoundation, "strings", {
            get: function () {
                return strings$1;
            },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(MDCTabIndicatorFoundation, "defaultAdapter", {
            get: function () {
                // tslint:disable:object-literal-sort-keys Methods should be in the same order as the adapter interface.
                return {
                    addClass: function () { return undefined; },
                    removeClass: function () { return undefined; },
                    computeContentClientRect: function () { return ({ top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0 }); },
                    setContentStyleProperty: function () { return undefined; },
                };
                // tslint:enable:object-literal-sort-keys
            },
            enumerable: true,
            configurable: true
        });
        MDCTabIndicatorFoundation.prototype.computeContentClientRect = function () {
            return this.adapter_.computeContentClientRect();
        };
        return MDCTabIndicatorFoundation;
    }(MDCFoundation));

    /**
     * @license
     * Copyright 2018 Google Inc.
     *
     * Permission is hereby granted, free of charge, to any person obtaining a copy
     * of this software and associated documentation files (the "Software"), to deal
     * in the Software without restriction, including without limitation the rights
     * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
     * copies of the Software, and to permit persons to whom the Software is
     * furnished to do so, subject to the following conditions:
     *
     * The above copyright notice and this permission notice shall be included in
     * all copies or substantial portions of the Software.
     *
     * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
     * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
     * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
     * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
     * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
     * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
     * THE SOFTWARE.
     */
    /* istanbul ignore next: subclass is not a branch statement */
    var MDCFadingTabIndicatorFoundation = /** @class */ (function (_super) {
        __extends(MDCFadingTabIndicatorFoundation, _super);
        function MDCFadingTabIndicatorFoundation() {
            return _super !== null && _super.apply(this, arguments) || this;
        }
        MDCFadingTabIndicatorFoundation.prototype.activate = function () {
            this.adapter_.addClass(MDCTabIndicatorFoundation.cssClasses.ACTIVE);
        };
        MDCFadingTabIndicatorFoundation.prototype.deactivate = function () {
            this.adapter_.removeClass(MDCTabIndicatorFoundation.cssClasses.ACTIVE);
        };
        return MDCFadingTabIndicatorFoundation;
    }(MDCTabIndicatorFoundation));

    /**
     * @license
     * Copyright 2018 Google Inc.
     *
     * Permission is hereby granted, free of charge, to any person obtaining a copy
     * of this software and associated documentation files (the "Software"), to deal
     * in the Software without restriction, including without limitation the rights
     * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
     * copies of the Software, and to permit persons to whom the Software is
     * furnished to do so, subject to the following conditions:
     *
     * The above copyright notice and this permission notice shall be included in
     * all copies or substantial portions of the Software.
     *
     * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
     * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
     * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
     * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
     * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
     * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
     * THE SOFTWARE.
     */
    /* istanbul ignore next: subclass is not a branch statement */
    var MDCSlidingTabIndicatorFoundation = /** @class */ (function (_super) {
        __extends(MDCSlidingTabIndicatorFoundation, _super);
        function MDCSlidingTabIndicatorFoundation() {
            return _super !== null && _super.apply(this, arguments) || this;
        }
        MDCSlidingTabIndicatorFoundation.prototype.activate = function (previousIndicatorClientRect) {
            // Early exit if no indicator is present to handle cases where an indicator
            // may be activated without a prior indicator state
            if (!previousIndicatorClientRect) {
                this.adapter_.addClass(MDCTabIndicatorFoundation.cssClasses.ACTIVE);
                return;
            }
            // This animation uses the FLIP approach. You can read more about it at the link below:
            // https://aerotwist.com/blog/flip-your-animations/
            // Calculate the dimensions based on the dimensions of the previous indicator
            var currentClientRect = this.computeContentClientRect();
            var widthDelta = previousIndicatorClientRect.width / currentClientRect.width;
            var xPosition = previousIndicatorClientRect.left - currentClientRect.left;
            this.adapter_.addClass(MDCTabIndicatorFoundation.cssClasses.NO_TRANSITION);
            this.adapter_.setContentStyleProperty('transform', "translateX(" + xPosition + "px) scaleX(" + widthDelta + ")");
            // Force repaint before updating classes and transform to ensure the transform properly takes effect
            this.computeContentClientRect();
            this.adapter_.removeClass(MDCTabIndicatorFoundation.cssClasses.NO_TRANSITION);
            this.adapter_.addClass(MDCTabIndicatorFoundation.cssClasses.ACTIVE);
            this.adapter_.setContentStyleProperty('transform', '');
        };
        MDCSlidingTabIndicatorFoundation.prototype.deactivate = function () {
            this.adapter_.removeClass(MDCTabIndicatorFoundation.cssClasses.ACTIVE);
        };
        return MDCSlidingTabIndicatorFoundation;
    }(MDCTabIndicatorFoundation));

    /**
     * @license
     * Copyright 2018 Google Inc.
     *
     * Permission is hereby granted, free of charge, to any person obtaining a copy
     * of this software and associated documentation files (the "Software"), to deal
     * in the Software without restriction, including without limitation the rights
     * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
     * copies of the Software, and to permit persons to whom the Software is
     * furnished to do so, subject to the following conditions:
     *
     * The above copyright notice and this permission notice shall be included in
     * all copies or substantial portions of the Software.
     *
     * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
     * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
     * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
     * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
     * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
     * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
     * THE SOFTWARE.
     */
    var MDCTabIndicator = /** @class */ (function (_super) {
        __extends(MDCTabIndicator, _super);
        function MDCTabIndicator() {
            return _super !== null && _super.apply(this, arguments) || this;
        }
        MDCTabIndicator.attachTo = function (root) {
            return new MDCTabIndicator(root);
        };
        MDCTabIndicator.prototype.initialize = function () {
            this.content_ = this.root_.querySelector(MDCTabIndicatorFoundation.strings.CONTENT_SELECTOR);
        };
        MDCTabIndicator.prototype.computeContentClientRect = function () {
            return this.foundation_.computeContentClientRect();
        };
        MDCTabIndicator.prototype.getDefaultFoundation = function () {
            var _this = this;
            // DO NOT INLINE this variable. For backward compatibility, foundations take a Partial<MDCFooAdapter>.
            // To ensure we don't accidentally omit any methods, we need a separate, strongly typed adapter variable.
            // tslint:disable:object-literal-sort-keys Methods should be in the same order as the adapter interface.
            var adapter = {
                addClass: function (className) { return _this.root_.classList.add(className); },
                removeClass: function (className) { return _this.root_.classList.remove(className); },
                computeContentClientRect: function () { return _this.content_.getBoundingClientRect(); },
                setContentStyleProperty: function (prop, value) { return _this.content_.style.setProperty(prop, value); },
            };
            // tslint:enable:object-literal-sort-keys
            if (this.root_.classList.contains(MDCTabIndicatorFoundation.cssClasses.FADE)) {
                return new MDCFadingTabIndicatorFoundation(adapter);
            }
            // Default to the sliding indicator
            return new MDCSlidingTabIndicatorFoundation(adapter);
        };
        MDCTabIndicator.prototype.activate = function (previousIndicatorClientRect) {
            this.foundation_.activate(previousIndicatorClientRect);
        };
        MDCTabIndicator.prototype.deactivate = function () {
            this.foundation_.deactivate();
        };
        return MDCTabIndicator;
    }(MDCComponent));

    /**
     * @license
     * Copyright 2018 Google Inc.
     *
     * Permission is hereby granted, free of charge, to any person obtaining a copy
     * of this software and associated documentation files (the "Software"), to deal
     * in the Software without restriction, including without limitation the rights
     * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
     * copies of the Software, and to permit persons to whom the Software is
     * furnished to do so, subject to the following conditions:
     *
     * The above copyright notice and this permission notice shall be included in
     * all copies or substantial portions of the Software.
     *
     * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
     * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
     * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
     * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
     * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
     * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
     * THE SOFTWARE.
     */
    var cssClasses$2 = {
        ACTIVE: 'mdc-tab--active',
    };
    var strings$2 = {
        ARIA_SELECTED: 'aria-selected',
        CONTENT_SELECTOR: '.mdc-tab__content',
        INTERACTED_EVENT: 'MDCTab:interacted',
        RIPPLE_SELECTOR: '.mdc-tab__ripple',
        TABINDEX: 'tabIndex',
        TAB_INDICATOR_SELECTOR: '.mdc-tab-indicator',
    };

    /**
     * @license
     * Copyright 2018 Google Inc.
     *
     * Permission is hereby granted, free of charge, to any person obtaining a copy
     * of this software and associated documentation files (the "Software"), to deal
     * in the Software without restriction, including without limitation the rights
     * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
     * copies of the Software, and to permit persons to whom the Software is
     * furnished to do so, subject to the following conditions:
     *
     * The above copyright notice and this permission notice shall be included in
     * all copies or substantial portions of the Software.
     *
     * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
     * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
     * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
     * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
     * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
     * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
     * THE SOFTWARE.
     */
    var MDCTabFoundation = /** @class */ (function (_super) {
        __extends(MDCTabFoundation, _super);
        function MDCTabFoundation(adapter) {
            var _this = _super.call(this, __assign({}, MDCTabFoundation.defaultAdapter, adapter)) || this;
            _this.focusOnActivate_ = true;
            return _this;
        }
        Object.defineProperty(MDCTabFoundation, "cssClasses", {
            get: function () {
                return cssClasses$2;
            },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(MDCTabFoundation, "strings", {
            get: function () {
                return strings$2;
            },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(MDCTabFoundation, "defaultAdapter", {
            get: function () {
                // tslint:disable:object-literal-sort-keys Methods should be in the same order as the adapter interface.
                return {
                    addClass: function () { return undefined; },
                    removeClass: function () { return undefined; },
                    hasClass: function () { return false; },
                    setAttr: function () { return undefined; },
                    activateIndicator: function () { return undefined; },
                    deactivateIndicator: function () { return undefined; },
                    notifyInteracted: function () { return undefined; },
                    getOffsetLeft: function () { return 0; },
                    getOffsetWidth: function () { return 0; },
                    getContentOffsetLeft: function () { return 0; },
                    getContentOffsetWidth: function () { return 0; },
                    focus: function () { return undefined; },
                };
                // tslint:enable:object-literal-sort-keys
            },
            enumerable: true,
            configurable: true
        });
        MDCTabFoundation.prototype.handleClick = function () {
            // It's up to the parent component to keep track of the active Tab and
            // ensure we don't activate a Tab that's already active.
            this.adapter_.notifyInteracted();
        };
        MDCTabFoundation.prototype.isActive = function () {
            return this.adapter_.hasClass(cssClasses$2.ACTIVE);
        };
        /**
         * Sets whether the tab should focus itself when activated
         */
        MDCTabFoundation.prototype.setFocusOnActivate = function (focusOnActivate) {
            this.focusOnActivate_ = focusOnActivate;
        };
        /**
         * Activates the Tab
         */
        MDCTabFoundation.prototype.activate = function (previousIndicatorClientRect) {
            this.adapter_.addClass(cssClasses$2.ACTIVE);
            this.adapter_.setAttr(strings$2.ARIA_SELECTED, 'true');
            this.adapter_.setAttr(strings$2.TABINDEX, '0');
            this.adapter_.activateIndicator(previousIndicatorClientRect);
            if (this.focusOnActivate_) {
                this.adapter_.focus();
            }
        };
        /**
         * Deactivates the Tab
         */
        MDCTabFoundation.prototype.deactivate = function () {
            // Early exit
            if (!this.isActive()) {
                return;
            }
            this.adapter_.removeClass(cssClasses$2.ACTIVE);
            this.adapter_.setAttr(strings$2.ARIA_SELECTED, 'false');
            this.adapter_.setAttr(strings$2.TABINDEX, '-1');
            this.adapter_.deactivateIndicator();
        };
        /**
         * Returns the dimensions of the Tab
         */
        MDCTabFoundation.prototype.computeDimensions = function () {
            var rootWidth = this.adapter_.getOffsetWidth();
            var rootLeft = this.adapter_.getOffsetLeft();
            var contentWidth = this.adapter_.getContentOffsetWidth();
            var contentLeft = this.adapter_.getContentOffsetLeft();
            return {
                contentLeft: rootLeft + contentLeft,
                contentRight: rootLeft + contentLeft + contentWidth,
                rootLeft: rootLeft,
                rootRight: rootLeft + rootWidth,
            };
        };
        return MDCTabFoundation;
    }(MDCFoundation));

    /**
     * @license
     * Copyright 2018 Google Inc.
     *
     * Permission is hereby granted, free of charge, to any person obtaining a copy
     * of this software and associated documentation files (the "Software"), to deal
     * in the Software without restriction, including without limitation the rights
     * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
     * copies of the Software, and to permit persons to whom the Software is
     * furnished to do so, subject to the following conditions:
     *
     * The above copyright notice and this permission notice shall be included in
     * all copies or substantial portions of the Software.
     *
     * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
     * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
     * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
     * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
     * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
     * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
     * THE SOFTWARE.
     */
    var MDCTab = /** @class */ (function (_super) {
        __extends(MDCTab, _super);
        function MDCTab() {
            return _super !== null && _super.apply(this, arguments) || this;
        }
        MDCTab.attachTo = function (root) {
            return new MDCTab(root);
        };
        MDCTab.prototype.initialize = function (rippleFactory, tabIndicatorFactory) {
            if (rippleFactory === void 0) { rippleFactory = function (el, foundation) { return new MDCRipple(el, foundation); }; }
            if (tabIndicatorFactory === void 0) { tabIndicatorFactory = function (el) { return new MDCTabIndicator(el); }; }
            this.id = this.root_.id;
            var rippleSurface = this.root_.querySelector(MDCTabFoundation.strings.RIPPLE_SELECTOR);
            var rippleAdapter = __assign({}, MDCRipple.createAdapter(this), { addClass: function (className) { return rippleSurface.classList.add(className); }, removeClass: function (className) { return rippleSurface.classList.remove(className); }, updateCssVariable: function (varName, value) { return rippleSurface.style.setProperty(varName, value); } });
            var rippleFoundation = new MDCRippleFoundation(rippleAdapter);
            this.ripple_ = rippleFactory(this.root_, rippleFoundation);
            var tabIndicatorElement = this.root_.querySelector(MDCTabFoundation.strings.TAB_INDICATOR_SELECTOR);
            this.tabIndicator_ = tabIndicatorFactory(tabIndicatorElement);
            this.content_ = this.root_.querySelector(MDCTabFoundation.strings.CONTENT_SELECTOR);
        };
        MDCTab.prototype.initialSyncWithDOM = function () {
            var _this = this;
            this.handleClick_ = function () { return _this.foundation_.handleClick(); };
            this.listen('click', this.handleClick_);
        };
        MDCTab.prototype.destroy = function () {
            this.unlisten('click', this.handleClick_);
            this.ripple_.destroy();
            _super.prototype.destroy.call(this);
        };
        MDCTab.prototype.getDefaultFoundation = function () {
            var _this = this;
            // DO NOT INLINE this variable. For backward compatibility, foundations take a Partial<MDCFooAdapter>.
            // To ensure we don't accidentally omit any methods, we need a separate, strongly typed adapter variable.
            // tslint:disable:object-literal-sort-keys Methods should be in the same order as the adapter interface.
            var adapter = {
                setAttr: function (attr, value) { return _this.root_.setAttribute(attr, value); },
                addClass: function (className) { return _this.root_.classList.add(className); },
                removeClass: function (className) { return _this.root_.classList.remove(className); },
                hasClass: function (className) { return _this.root_.classList.contains(className); },
                activateIndicator: function (previousIndicatorClientRect) { return _this.tabIndicator_.activate(previousIndicatorClientRect); },
                deactivateIndicator: function () { return _this.tabIndicator_.deactivate(); },
                notifyInteracted: function () { return _this.emit(MDCTabFoundation.strings.INTERACTED_EVENT, { tabId: _this.id }, true /* bubble */); },
                getOffsetLeft: function () { return _this.root_.offsetLeft; },
                getOffsetWidth: function () { return _this.root_.offsetWidth; },
                getContentOffsetLeft: function () { return _this.content_.offsetLeft; },
                getContentOffsetWidth: function () { return _this.content_.offsetWidth; },
                focus: function () { return _this.root_.focus(); },
            };
            // tslint:enable:object-literal-sort-keys
            return new MDCTabFoundation(adapter);
        };
        Object.defineProperty(MDCTab.prototype, "active", {
            /**
             * Getter for the active state of the tab
             */
            get: function () {
                return this.foundation_.isActive();
            },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(MDCTab.prototype, "focusOnActivate", {
            set: function (focusOnActivate) {
                this.foundation_.setFocusOnActivate(focusOnActivate);
            },
            enumerable: true,
            configurable: true
        });
        /**
         * Activates the tab
         */
        MDCTab.prototype.activate = function (computeIndicatorClientRect) {
            this.foundation_.activate(computeIndicatorClientRect);
        };
        /**
         * Deactivates the tab
         */
        MDCTab.prototype.deactivate = function () {
            this.foundation_.deactivate();
        };
        /**
         * Returns the indicator's client rect
         */
        MDCTab.prototype.computeIndicatorClientRect = function () {
            return this.tabIndicator_.computeContentClientRect();
        };
        MDCTab.prototype.computeDimensions = function () {
            return this.foundation_.computeDimensions();
        };
        /**
         * Focuses the tab
         */
        MDCTab.prototype.focus = function () {
            this.root_.focus();
        };
        return MDCTab;
    }(MDCComponent));

    function prefixFilter(obj, prefix) {
      let names = Object.getOwnPropertyNames(obj);
      const newObj = {};

      for (let i = 0; i < names.length; i++) {
        const name = names[i];
        if (name.substring(0, prefix.length) === prefix) {
          newObj[name.substring(prefix.length)] = obj[name];
        }
      }

      return newObj;
    }

    /* node_modules\@smui\tab-indicator\TabIndicator.svelte generated by Svelte v3.24.1 */

    function create_fragment$1(ctx) {
    	let span1;
    	let span0;
    	let span0_class_value;
    	let span0_aria_hidden_value;
    	let useActions_action;
    	let span1_class_value;
    	let useActions_action_1;
    	let forwardEvents_action;
    	let current;
    	let mounted;
    	let dispose;
    	const default_slot_template = /*$$slots*/ ctx[14].default;
    	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[13], null);

    	let span0_levels = [
    		{
    			class: span0_class_value = "\n      mdc-tab-indicator__content\n      " + /*content$class*/ ctx[6] + "\n      " + (/*type*/ ctx[3] === "underline"
    			? "mdc-tab-indicator__content--underline"
    			: "") + "\n      " + (/*type*/ ctx[3] === "icon"
    			? "mdc-tab-indicator__content--icon"
    			: "") + "\n    "
    		},
    		{
    			"aria-hidden": span0_aria_hidden_value = /*type*/ ctx[3] === "icon" ? "true" : "false"
    		},
    		exclude(prefixFilter(/*$$props*/ ctx[9], "content$"), ["use", "class"])
    	];

    	let span0_data = {};

    	for (let i = 0; i < span0_levels.length; i += 1) {
    		span0_data = assign(span0_data, span0_levels[i]);
    	}

    	let span1_levels = [
    		{
    			class: span1_class_value = "\n    mdc-tab-indicator\n    " + /*className*/ ctx[1] + "\n    " + (/*active*/ ctx[2] ? "mdc-tab-indicator--active" : "") + "\n    " + (/*transition*/ ctx[4] === "fade"
    			? "mdc-tab-indicator--fade"
    			: "") + "\n  "
    		},
    		exclude(/*$$props*/ ctx[9], ["use", "class", "active", "type", "transition", "content$"])
    	];

    	let span1_data = {};

    	for (let i = 0; i < span1_levels.length; i += 1) {
    		span1_data = assign(span1_data, span1_levels[i]);
    	}

    	return {
    		c() {
    			span1 = element("span");
    			span0 = element("span");
    			if (default_slot) default_slot.c();
    			set_attributes(span0, span0_data);
    			set_attributes(span1, span1_data);
    		},
    		m(target, anchor) {
    			insert(target, span1, anchor);
    			append(span1, span0);

    			if (default_slot) {
    				default_slot.m(span0, null);
    			}

    			/*span1_binding*/ ctx[15](span1);
    			current = true;

    			if (!mounted) {
    				dispose = [
    					action_destroyer(useActions_action = useActions.call(null, span0, /*content$use*/ ctx[5])),
    					action_destroyer(useActions_action_1 = useActions.call(null, span1, /*use*/ ctx[0])),
    					action_destroyer(forwardEvents_action = /*forwardEvents*/ ctx[8].call(null, span1))
    				];

    				mounted = true;
    			}
    		},
    		p(ctx, [dirty]) {
    			if (default_slot) {
    				if (default_slot.p && dirty & /*$$scope*/ 8192) {
    					update_slot(default_slot, default_slot_template, ctx, /*$$scope*/ ctx[13], dirty, null, null);
    				}
    			}

    			set_attributes(span0, span0_data = get_spread_update(span0_levels, [
    				(!current || dirty & /*content$class, type*/ 72 && span0_class_value !== (span0_class_value = "\n      mdc-tab-indicator__content\n      " + /*content$class*/ ctx[6] + "\n      " + (/*type*/ ctx[3] === "underline"
    				? "mdc-tab-indicator__content--underline"
    				: "") + "\n      " + (/*type*/ ctx[3] === "icon"
    				? "mdc-tab-indicator__content--icon"
    				: "") + "\n    ")) && { class: span0_class_value },
    				(!current || dirty & /*type*/ 8 && span0_aria_hidden_value !== (span0_aria_hidden_value = /*type*/ ctx[3] === "icon" ? "true" : "false")) && { "aria-hidden": span0_aria_hidden_value },
    				dirty & /*$$props*/ 512 && exclude(prefixFilter(/*$$props*/ ctx[9], "content$"), ["use", "class"])
    			]));

    			if (useActions_action && is_function(useActions_action.update) && dirty & /*content$use*/ 32) useActions_action.update.call(null, /*content$use*/ ctx[5]);

    			set_attributes(span1, span1_data = get_spread_update(span1_levels, [
    				(!current || dirty & /*className, active, transition*/ 22 && span1_class_value !== (span1_class_value = "\n    mdc-tab-indicator\n    " + /*className*/ ctx[1] + "\n    " + (/*active*/ ctx[2] ? "mdc-tab-indicator--active" : "") + "\n    " + (/*transition*/ ctx[4] === "fade"
    				? "mdc-tab-indicator--fade"
    				: "") + "\n  ")) && { class: span1_class_value },
    				dirty & /*$$props*/ 512 && exclude(/*$$props*/ ctx[9], ["use", "class", "active", "type", "transition", "content$"])
    			]));

    			if (useActions_action_1 && is_function(useActions_action_1.update) && dirty & /*use*/ 1) useActions_action_1.update.call(null, /*use*/ ctx[0]);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(default_slot, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(default_slot, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(span1);
    			if (default_slot) default_slot.d(detaching);
    			/*span1_binding*/ ctx[15](null);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    function instance$1($$self, $$props, $$invalidate) {
    	const forwardEvents = forwardEventsBuilder(get_current_component());
    	let { use = [] } = $$props;
    	let { class: className = "" } = $$props;
    	let { active = false } = $$props;
    	let { type = "underline" } = $$props;
    	let { transition = "slide" } = $$props;
    	let { content$use = [] } = $$props;
    	let { content$class = "" } = $$props;
    	let element;
    	let tabIndicator;
    	let instantiate = getContext("SMUI:tab-indicator:instantiate");
    	let getInstance = getContext("SMUI:tab-indicator:getInstance");

    	onMount(async () => {
    		if (instantiate !== false) {
    			tabIndicator = new MDCTabIndicator(element);
    		} else {
    			tabIndicator = await getInstance();
    		}
    	});

    	onDestroy(() => {
    		tabIndicator && tabIndicator.destroy();
    	});

    	function activate(...args) {
    		return tabIndicator.activate(...args);
    	}

    	function deactivate(...args) {
    		return tabIndicator.deactivate(...args);
    	}

    	function computeContentClientRect(...args) {
    		return tabIndicator.computeContentClientRect(...args);
    	}

    	let { $$slots = {}, $$scope } = $$props;

    	function span1_binding($$value) {
    		binding_callbacks[$$value ? "unshift" : "push"](() => {
    			element = $$value;
    			$$invalidate(7, element);
    		});
    	}

    	$$self.$$set = $$new_props => {
    		$$invalidate(9, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
    		if ("use" in $$new_props) $$invalidate(0, use = $$new_props.use);
    		if ("class" in $$new_props) $$invalidate(1, className = $$new_props.class);
    		if ("active" in $$new_props) $$invalidate(2, active = $$new_props.active);
    		if ("type" in $$new_props) $$invalidate(3, type = $$new_props.type);
    		if ("transition" in $$new_props) $$invalidate(4, transition = $$new_props.transition);
    		if ("content$use" in $$new_props) $$invalidate(5, content$use = $$new_props.content$use);
    		if ("content$class" in $$new_props) $$invalidate(6, content$class = $$new_props.content$class);
    		if ("$$scope" in $$new_props) $$invalidate(13, $$scope = $$new_props.$$scope);
    	};

    	$$props = exclude_internal_props($$props);

    	return [
    		use,
    		className,
    		active,
    		type,
    		transition,
    		content$use,
    		content$class,
    		element,
    		forwardEvents,
    		$$props,
    		activate,
    		deactivate,
    		computeContentClientRect,
    		$$scope,
    		$$slots,
    		span1_binding
    	];
    }

    class TabIndicator extends SvelteComponent {
    	constructor(options) {
    		super();

    		init(this, options, instance$1, create_fragment$1, safe_not_equal, {
    			use: 0,
    			class: 1,
    			active: 2,
    			type: 3,
    			transition: 4,
    			content$use: 5,
    			content$class: 6,
    			activate: 10,
    			deactivate: 11,
    			computeContentClientRect: 12
    		});
    	}

    	get activate() {
    		return this.$$.ctx[10];
    	}

    	get deactivate() {
    		return this.$$.ctx[11];
    	}

    	get computeContentClientRect() {
    		return this.$$.ctx[12];
    	}
    }

    /* node_modules\@smui\tab\Tab.svelte generated by Svelte v3.24.1 */
    const get_tab_indicator_slot_changes_1 = dirty => ({});
    const get_tab_indicator_slot_context_1 = ctx => ({});
    const get_tab_indicator_slot_changes = dirty => ({});
    const get_tab_indicator_slot_context = ctx => ({});

    // (24:4) {#if indicatorSpanOnlyContent}
    function create_if_block_2(ctx) {
    	let tabindicator;
    	let current;

    	const tabindicator_spread_levels = [
    		{ active: /*active*/ ctx[0] },
    		prefixFilter(/*$$props*/ ctx[12], "tabIndicator$")
    	];

    	let tabindicator_props = {
    		$$slots: { default: [create_default_slot_1] },
    		$$scope: { ctx }
    	};

    	for (let i = 0; i < tabindicator_spread_levels.length; i += 1) {
    		tabindicator_props = assign(tabindicator_props, tabindicator_spread_levels[i]);
    	}

    	tabindicator = new TabIndicator({ props: tabindicator_props });

    	return {
    		c() {
    			create_component(tabindicator.$$.fragment);
    		},
    		m(target, anchor) {
    			mount_component(tabindicator, target, anchor);
    			current = true;
    		},
    		p(ctx, dirty) {
    			const tabindicator_changes = (dirty & /*active, prefixFilter, $$props*/ 4097)
    			? get_spread_update(tabindicator_spread_levels, [
    					dirty & /*active*/ 1 && { active: /*active*/ ctx[0] },
    					dirty & /*prefixFilter, $$props*/ 4096 && get_spread_object(prefixFilter(/*$$props*/ ctx[12], "tabIndicator$"))
    				])
    			: {};

    			if (dirty & /*$$scope*/ 4194304) {
    				tabindicator_changes.$$scope = { dirty, ctx };
    			}

    			tabindicator.$set(tabindicator_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(tabindicator.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(tabindicator.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(tabindicator, detaching);
    		}
    	};
    }

    // (25:6) <TabIndicator         {active}         {...prefixFilter($$props, 'tabIndicator$')}       >
    function create_default_slot_1(ctx) {
    	let current;
    	const tab_indicator_slot_template = /*$$slots*/ ctx[20]["tab-indicator"];
    	const tab_indicator_slot = create_slot(tab_indicator_slot_template, ctx, /*$$scope*/ ctx[22], get_tab_indicator_slot_context);

    	return {
    		c() {
    			if (tab_indicator_slot) tab_indicator_slot.c();
    		},
    		m(target, anchor) {
    			if (tab_indicator_slot) {
    				tab_indicator_slot.m(target, anchor);
    			}

    			current = true;
    		},
    		p(ctx, dirty) {
    			if (tab_indicator_slot) {
    				if (tab_indicator_slot.p && dirty & /*$$scope*/ 4194304) {
    					update_slot(tab_indicator_slot, tab_indicator_slot_template, ctx, /*$$scope*/ ctx[22], dirty, get_tab_indicator_slot_changes, get_tab_indicator_slot_context);
    				}
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(tab_indicator_slot, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(tab_indicator_slot, local);
    			current = false;
    		},
    		d(detaching) {
    			if (tab_indicator_slot) tab_indicator_slot.d(detaching);
    		}
    	};
    }

    // (31:2) {#if !indicatorSpanOnlyContent}
    function create_if_block_1(ctx) {
    	let tabindicator;
    	let current;

    	const tabindicator_spread_levels = [
    		{ active: /*active*/ ctx[0] },
    		prefixFilter(/*$$props*/ ctx[12], "tabIndicator$")
    	];

    	let tabindicator_props = {
    		$$slots: { default: [create_default_slot] },
    		$$scope: { ctx }
    	};

    	for (let i = 0; i < tabindicator_spread_levels.length; i += 1) {
    		tabindicator_props = assign(tabindicator_props, tabindicator_spread_levels[i]);
    	}

    	tabindicator = new TabIndicator({ props: tabindicator_props });

    	return {
    		c() {
    			create_component(tabindicator.$$.fragment);
    		},
    		m(target, anchor) {
    			mount_component(tabindicator, target, anchor);
    			current = true;
    		},
    		p(ctx, dirty) {
    			const tabindicator_changes = (dirty & /*active, prefixFilter, $$props*/ 4097)
    			? get_spread_update(tabindicator_spread_levels, [
    					dirty & /*active*/ 1 && { active: /*active*/ ctx[0] },
    					dirty & /*prefixFilter, $$props*/ 4096 && get_spread_object(prefixFilter(/*$$props*/ ctx[12], "tabIndicator$"))
    				])
    			: {};

    			if (dirty & /*$$scope*/ 4194304) {
    				tabindicator_changes.$$scope = { dirty, ctx };
    			}

    			tabindicator.$set(tabindicator_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(tabindicator.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(tabindicator.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(tabindicator, detaching);
    		}
    	};
    }

    // (32:4) <TabIndicator       {active}       {...prefixFilter($$props, 'tabIndicator$')}     >
    function create_default_slot(ctx) {
    	let current;
    	const tab_indicator_slot_template = /*$$slots*/ ctx[20]["tab-indicator"];
    	const tab_indicator_slot = create_slot(tab_indicator_slot_template, ctx, /*$$scope*/ ctx[22], get_tab_indicator_slot_context_1);

    	return {
    		c() {
    			if (tab_indicator_slot) tab_indicator_slot.c();
    		},
    		m(target, anchor) {
    			if (tab_indicator_slot) {
    				tab_indicator_slot.m(target, anchor);
    			}

    			current = true;
    		},
    		p(ctx, dirty) {
    			if (tab_indicator_slot) {
    				if (tab_indicator_slot.p && dirty & /*$$scope*/ 4194304) {
    					update_slot(tab_indicator_slot, tab_indicator_slot_template, ctx, /*$$scope*/ ctx[22], dirty, get_tab_indicator_slot_changes_1, get_tab_indicator_slot_context_1);
    				}
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(tab_indicator_slot, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(tab_indicator_slot, local);
    			current = false;
    		},
    		d(detaching) {
    			if (tab_indicator_slot) tab_indicator_slot.d(detaching);
    		}
    	};
    }

    // (37:2) {#if ripple}
    function create_if_block(ctx) {
    	let span;

    	return {
    		c() {
    			span = element("span");
    			attr(span, "class", "mdc-tab__ripple");
    		},
    		m(target, anchor) {
    			insert(target, span, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(span);
    		}
    	};
    }

    function create_fragment$2(ctx) {
    	let button;
    	let span;
    	let t0;
    	let span_class_value;
    	let useActions_action;
    	let t1;
    	let t2;
    	let button_class_value;
    	let button_tabindex_value;
    	let useActions_action_1;
    	let forwardEvents_action;
    	let current;
    	let mounted;
    	let dispose;
    	const default_slot_template = /*$$slots*/ ctx[20].default;
    	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[22], null);
    	let if_block0 = /*indicatorSpanOnlyContent*/ ctx[6] && create_if_block_2(ctx);

    	let span_levels = [
    		{
    			class: span_class_value = "mdc-tab__content " + /*content$class*/ ctx[8]
    		},
    		exclude(prefixFilter(/*$$props*/ ctx[12], "content$"), ["use", "class"])
    	];

    	let span_data = {};

    	for (let i = 0; i < span_levels.length; i += 1) {
    		span_data = assign(span_data, span_levels[i]);
    	}

    	let if_block1 = !/*indicatorSpanOnlyContent*/ ctx[6] && create_if_block_1(ctx);
    	let if_block2 = /*ripple*/ ctx[3] && create_if_block();

    	let button_levels = [
    		{
    			class: button_class_value = "\n    mdc-tab\n    " + /*className*/ ctx[2] + "\n    " + (/*active*/ ctx[0] ? "mdc-tab--active" : "") + "\n    " + (/*stacked*/ ctx[4] ? "mdc-tab--stacked" : "") + "\n    " + (/*minWidth*/ ctx[5] ? "mdc-tab--min-width" : "") + "\n  "
    		},
    		{ role: "tab" },
    		{ "aria-selected": /*active*/ ctx[0] },
    		{
    			tabindex: button_tabindex_value = /*active*/ ctx[0] ? "0" : "-1"
    		},
    		exclude(/*$$props*/ ctx[12], [
    			"use",
    			"class",
    			"ripple",
    			"active",
    			"stacked",
    			"minWidth",
    			"indicatorSpanOnlyContent",
    			"focusOnActivate",
    			"content$",
    			"tabIndicator$"
    		])
    	];

    	let button_data = {};

    	for (let i = 0; i < button_levels.length; i += 1) {
    		button_data = assign(button_data, button_levels[i]);
    	}

    	return {
    		c() {
    			button = element("button");
    			span = element("span");
    			if (default_slot) default_slot.c();
    			t0 = space();
    			if (if_block0) if_block0.c();
    			t1 = space();
    			if (if_block1) if_block1.c();
    			t2 = space();
    			if (if_block2) if_block2.c();
    			set_attributes(span, span_data);
    			set_attributes(button, button_data);
    		},
    		m(target, anchor) {
    			insert(target, button, anchor);
    			append(button, span);

    			if (default_slot) {
    				default_slot.m(span, null);
    			}

    			append(span, t0);
    			if (if_block0) if_block0.m(span, null);
    			append(button, t1);
    			if (if_block1) if_block1.m(button, null);
    			append(button, t2);
    			if (if_block2) if_block2.m(button, null);
    			/*button_binding*/ ctx[21](button);
    			current = true;

    			if (!mounted) {
    				dispose = [
    					action_destroyer(useActions_action = useActions.call(null, span, /*content$use*/ ctx[7])),
    					action_destroyer(useActions_action_1 = useActions.call(null, button, /*use*/ ctx[1])),
    					action_destroyer(forwardEvents_action = /*forwardEvents*/ ctx[10].call(null, button)),
    					listen(button, "MDCTab:interacted", /*interactedHandler*/ ctx[11])
    				];

    				mounted = true;
    			}
    		},
    		p(ctx, [dirty]) {
    			if (default_slot) {
    				if (default_slot.p && dirty & /*$$scope*/ 4194304) {
    					update_slot(default_slot, default_slot_template, ctx, /*$$scope*/ ctx[22], dirty, null, null);
    				}
    			}

    			if (/*indicatorSpanOnlyContent*/ ctx[6]) {
    				if (if_block0) {
    					if_block0.p(ctx, dirty);

    					if (dirty & /*indicatorSpanOnlyContent*/ 64) {
    						transition_in(if_block0, 1);
    					}
    				} else {
    					if_block0 = create_if_block_2(ctx);
    					if_block0.c();
    					transition_in(if_block0, 1);
    					if_block0.m(span, null);
    				}
    			} else if (if_block0) {
    				group_outros();

    				transition_out(if_block0, 1, 1, () => {
    					if_block0 = null;
    				});

    				check_outros();
    			}

    			set_attributes(span, span_data = get_spread_update(span_levels, [
    				(!current || dirty & /*content$class*/ 256 && span_class_value !== (span_class_value = "mdc-tab__content " + /*content$class*/ ctx[8])) && { class: span_class_value },
    				dirty & /*$$props*/ 4096 && exclude(prefixFilter(/*$$props*/ ctx[12], "content$"), ["use", "class"])
    			]));

    			if (useActions_action && is_function(useActions_action.update) && dirty & /*content$use*/ 128) useActions_action.update.call(null, /*content$use*/ ctx[7]);

    			if (!/*indicatorSpanOnlyContent*/ ctx[6]) {
    				if (if_block1) {
    					if_block1.p(ctx, dirty);

    					if (dirty & /*indicatorSpanOnlyContent*/ 64) {
    						transition_in(if_block1, 1);
    					}
    				} else {
    					if_block1 = create_if_block_1(ctx);
    					if_block1.c();
    					transition_in(if_block1, 1);
    					if_block1.m(button, t2);
    				}
    			} else if (if_block1) {
    				group_outros();

    				transition_out(if_block1, 1, 1, () => {
    					if_block1 = null;
    				});

    				check_outros();
    			}

    			if (/*ripple*/ ctx[3]) {
    				if (if_block2) ; else {
    					if_block2 = create_if_block();
    					if_block2.c();
    					if_block2.m(button, null);
    				}
    			} else if (if_block2) {
    				if_block2.d(1);
    				if_block2 = null;
    			}

    			set_attributes(button, button_data = get_spread_update(button_levels, [
    				(!current || dirty & /*className, active, stacked, minWidth*/ 53 && button_class_value !== (button_class_value = "\n    mdc-tab\n    " + /*className*/ ctx[2] + "\n    " + (/*active*/ ctx[0] ? "mdc-tab--active" : "") + "\n    " + (/*stacked*/ ctx[4] ? "mdc-tab--stacked" : "") + "\n    " + (/*minWidth*/ ctx[5] ? "mdc-tab--min-width" : "") + "\n  ")) && { class: button_class_value },
    				{ role: "tab" },
    				(!current || dirty & /*active*/ 1) && { "aria-selected": /*active*/ ctx[0] },
    				(!current || dirty & /*active*/ 1 && button_tabindex_value !== (button_tabindex_value = /*active*/ ctx[0] ? "0" : "-1")) && { tabindex: button_tabindex_value },
    				dirty & /*$$props*/ 4096 && exclude(/*$$props*/ ctx[12], [
    					"use",
    					"class",
    					"ripple",
    					"active",
    					"stacked",
    					"minWidth",
    					"indicatorSpanOnlyContent",
    					"focusOnActivate",
    					"content$",
    					"tabIndicator$"
    				])
    			]));

    			if (useActions_action_1 && is_function(useActions_action_1.update) && dirty & /*use*/ 2) useActions_action_1.update.call(null, /*use*/ ctx[1]);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(default_slot, local);
    			transition_in(if_block0);
    			transition_in(if_block1);
    			current = true;
    		},
    		o(local) {
    			transition_out(default_slot, local);
    			transition_out(if_block0);
    			transition_out(if_block1);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(button);
    			if (default_slot) default_slot.d(detaching);
    			if (if_block0) if_block0.d();
    			if (if_block1) if_block1.d();
    			if (if_block2) if_block2.d();
    			/*button_binding*/ ctx[21](null);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    function instance$2($$self, $$props, $$invalidate) {
    	const forwardEvents = forwardEventsBuilder(get_current_component(), ["MDCTab:interacted"]);
    	let activeEntry = getContext("SMUI:tab:active");
    	let { use = [] } = $$props;
    	let { class: className = "" } = $$props;
    	let { tab: tabEntry } = $$props;
    	let { ripple = true } = $$props;
    	let { active = tabEntry === activeEntry } = $$props;
    	let { stacked = false } = $$props;
    	let { minWidth = false } = $$props;
    	let { indicatorSpanOnlyContent = false } = $$props;
    	let { focusOnActivate = true } = $$props;
    	let { content$use = [] } = $$props;
    	let { content$class = "" } = $$props;
    	let element;
    	let tab;
    	let instantiate = getContext("SMUI:tab:instantiate");
    	let getInstance = getContext("SMUI:tab:getInstance");
    	let tabIndicatorPromiseResolve;
    	let tabIndicatorPromise = new Promise(resolve => tabIndicatorPromiseResolve = resolve);
    	setContext("SMUI:tab-indicator:instantiate", false);
    	setContext("SMUI:tab-indicator:getInstance", getTabIndicatorInstancePromise);
    	setContext("SMUI:label:context", "tab");
    	setContext("SMUI:icon:context", "tab");

    	if (!tabEntry) {
    		throw new Error("The tab property is required! It should be passed down from the TabBar to the Tab.");
    	}

    	onMount(async () => {
    		if (instantiate !== false) {
    			$$invalidate(23, tab = new MDCTab(element));
    		} else {
    			$$invalidate(23, tab = await getInstance(tabEntry));
    		}

    		tabIndicatorPromiseResolve(tab.tabIndicator_);

    		if (!ripple) {
    			tab.ripple_ && tab.ripple_.destroy();
    		}
    	});

    	onDestroy(() => {
    		tab && tab.destroy();
    	});

    	function getTabIndicatorInstancePromise() {
    		return tabIndicatorPromise;
    	}

    	function interactedHandler() {
    		$$invalidate(0, active = tab.active);
    	}

    	function activate(...args) {
    		$$invalidate(0, active = true);
    		return tab.activate(...args);
    	}

    	function deactivate(...args) {
    		$$invalidate(0, active = false);
    		return tab.deactivate(...args);
    	}

    	function focus(...args) {
    		return tab.focus(...args);
    	}

    	function computeIndicatorClientRect(...args) {
    		return tab.computeIndicatorClientRect(...args);
    	}

    	function computeDimensions(...args) {
    		return tab.computeDimensions(...args);
    	}

    	let { $$slots = {}, $$scope } = $$props;

    	function button_binding($$value) {
    		binding_callbacks[$$value ? "unshift" : "push"](() => {
    			element = $$value;
    			$$invalidate(9, element);
    		});
    	}

    	$$self.$$set = $$new_props => {
    		$$invalidate(12, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
    		if ("use" in $$new_props) $$invalidate(1, use = $$new_props.use);
    		if ("class" in $$new_props) $$invalidate(2, className = $$new_props.class);
    		if ("tab" in $$new_props) $$invalidate(13, tabEntry = $$new_props.tab);
    		if ("ripple" in $$new_props) $$invalidate(3, ripple = $$new_props.ripple);
    		if ("active" in $$new_props) $$invalidate(0, active = $$new_props.active);
    		if ("stacked" in $$new_props) $$invalidate(4, stacked = $$new_props.stacked);
    		if ("minWidth" in $$new_props) $$invalidate(5, minWidth = $$new_props.minWidth);
    		if ("indicatorSpanOnlyContent" in $$new_props) $$invalidate(6, indicatorSpanOnlyContent = $$new_props.indicatorSpanOnlyContent);
    		if ("focusOnActivate" in $$new_props) $$invalidate(14, focusOnActivate = $$new_props.focusOnActivate);
    		if ("content$use" in $$new_props) $$invalidate(7, content$use = $$new_props.content$use);
    		if ("content$class" in $$new_props) $$invalidate(8, content$class = $$new_props.content$class);
    		if ("$$scope" in $$new_props) $$invalidate(22, $$scope = $$new_props.$$scope);
    	};

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*tab, focusOnActivate*/ 8404992) {
    			 if (tab) {
    				$$invalidate(23, tab.focusOnActivate = focusOnActivate, tab);
    			}
    		}

    		if ($$self.$$.dirty & /*tab, active*/ 8388609) {
    			 if (tab && tab.active !== active) {
    				$$invalidate(0, active = tab.active);
    			}
    		}
    	};

    	$$props = exclude_internal_props($$props);

    	return [
    		active,
    		use,
    		className,
    		ripple,
    		stacked,
    		minWidth,
    		indicatorSpanOnlyContent,
    		content$use,
    		content$class,
    		element,
    		forwardEvents,
    		interactedHandler,
    		$$props,
    		tabEntry,
    		focusOnActivate,
    		activate,
    		deactivate,
    		focus,
    		computeIndicatorClientRect,
    		computeDimensions,
    		$$slots,
    		button_binding,
    		$$scope
    	];
    }

    class Tab extends SvelteComponent {
    	constructor(options) {
    		super();

    		init(this, options, instance$2, create_fragment$2, safe_not_equal, {
    			use: 1,
    			class: 2,
    			tab: 13,
    			ripple: 3,
    			active: 0,
    			stacked: 4,
    			minWidth: 5,
    			indicatorSpanOnlyContent: 6,
    			focusOnActivate: 14,
    			content$use: 7,
    			content$class: 8,
    			activate: 15,
    			deactivate: 16,
    			focus: 17,
    			computeIndicatorClientRect: 18,
    			computeDimensions: 19
    		});
    	}

    	get activate() {
    		return this.$$.ctx[15];
    	}

    	get deactivate() {
    		return this.$$.ctx[16];
    	}

    	get focus() {
    		return this.$$.ctx[17];
    	}

    	get computeIndicatorClientRect() {
    		return this.$$.ctx[18];
    	}

    	get computeDimensions() {
    		return this.$$.ctx[19];
    	}
    }

    /* node_modules\@smui\common\Label.svelte generated by Svelte v3.24.1 */

    function create_fragment$3(ctx) {
    	let span;
    	let span_class_value;
    	let useActions_action;
    	let forwardEvents_action;
    	let current;
    	let mounted;
    	let dispose;
    	const default_slot_template = /*$$slots*/ ctx[6].default;
    	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[5], null);

    	let span_levels = [
    		{
    			class: span_class_value = "\n    " + /*className*/ ctx[1] + "\n    " + (/*context*/ ctx[3] === "button"
    			? "mdc-button__label"
    			: "") + "\n    " + (/*context*/ ctx[3] === "fab" ? "mdc-fab__label" : "") + "\n    " + (/*context*/ ctx[3] === "chip" ? "mdc-chip__text" : "") + "\n    " + (/*context*/ ctx[3] === "tab"
    			? "mdc-tab__text-label"
    			: "") + "\n    " + (/*context*/ ctx[3] === "image-list"
    			? "mdc-image-list__label"
    			: "") + "\n    " + (/*context*/ ctx[3] === "snackbar"
    			? "mdc-snackbar__label"
    			: "") + "\n  "
    		},
    		/*context*/ ctx[3] === "snackbar"
    		? { role: "status", "aria-live": "polite" }
    		: {},
    		exclude(/*$$props*/ ctx[4], ["use", "class"])
    	];

    	let span_data = {};

    	for (let i = 0; i < span_levels.length; i += 1) {
    		span_data = assign(span_data, span_levels[i]);
    	}

    	return {
    		c() {
    			span = element("span");
    			if (default_slot) default_slot.c();
    			set_attributes(span, span_data);
    		},
    		m(target, anchor) {
    			insert(target, span, anchor);

    			if (default_slot) {
    				default_slot.m(span, null);
    			}

    			current = true;

    			if (!mounted) {
    				dispose = [
    					action_destroyer(useActions_action = useActions.call(null, span, /*use*/ ctx[0])),
    					action_destroyer(forwardEvents_action = /*forwardEvents*/ ctx[2].call(null, span))
    				];

    				mounted = true;
    			}
    		},
    		p(ctx, [dirty]) {
    			if (default_slot) {
    				if (default_slot.p && dirty & /*$$scope*/ 32) {
    					update_slot(default_slot, default_slot_template, ctx, /*$$scope*/ ctx[5], dirty, null, null);
    				}
    			}

    			set_attributes(span, span_data = get_spread_update(span_levels, [
    				(!current || dirty & /*className*/ 2 && span_class_value !== (span_class_value = "\n    " + /*className*/ ctx[1] + "\n    " + (/*context*/ ctx[3] === "button"
    				? "mdc-button__label"
    				: "") + "\n    " + (/*context*/ ctx[3] === "fab" ? "mdc-fab__label" : "") + "\n    " + (/*context*/ ctx[3] === "chip" ? "mdc-chip__text" : "") + "\n    " + (/*context*/ ctx[3] === "tab"
    				? "mdc-tab__text-label"
    				: "") + "\n    " + (/*context*/ ctx[3] === "image-list"
    				? "mdc-image-list__label"
    				: "") + "\n    " + (/*context*/ ctx[3] === "snackbar"
    				? "mdc-snackbar__label"
    				: "") + "\n  ")) && { class: span_class_value },
    				/*context*/ ctx[3] === "snackbar"
    				? { role: "status", "aria-live": "polite" }
    				: {},
    				dirty & /*$$props*/ 16 && exclude(/*$$props*/ ctx[4], ["use", "class"])
    			]));

    			if (useActions_action && is_function(useActions_action.update) && dirty & /*use*/ 1) useActions_action.update.call(null, /*use*/ ctx[0]);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(default_slot, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(default_slot, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(span);
    			if (default_slot) default_slot.d(detaching);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    function instance$3($$self, $$props, $$invalidate) {
    	const forwardEvents = forwardEventsBuilder(get_current_component());
    	let { use = [] } = $$props;
    	let { class: className = "" } = $$props;
    	const context = getContext("SMUI:label:context");
    	let { $$slots = {}, $$scope } = $$props;

    	$$self.$$set = $$new_props => {
    		$$invalidate(4, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
    		if ("use" in $$new_props) $$invalidate(0, use = $$new_props.use);
    		if ("class" in $$new_props) $$invalidate(1, className = $$new_props.class);
    		if ("$$scope" in $$new_props) $$invalidate(5, $$scope = $$new_props.$$scope);
    	};

    	$$props = exclude_internal_props($$props);
    	return [use, className, forwardEvents, context, $$props, $$scope, $$slots];
    }

    class Label extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$3, create_fragment$3, safe_not_equal, { use: 0, class: 1 });
    	}
    }

    var css_248z$1 = ".mdc-tab {\n  font-family: Roboto, sans-serif;\n  -moz-osx-font-smoothing: grayscale;\n  -webkit-font-smoothing: antialiased;\n  font-size: 0.875rem;\n  line-height: 2.25rem;\n  font-weight: 500;\n  letter-spacing: 0.0892857143em;\n  text-decoration: none;\n  text-transform: uppercase;\n  padding-right: 24px;\n  padding-left: 24px;\n  position: relative;\n  display: flex;\n  flex: 1 0 auto;\n  justify-content: center;\n  box-sizing: border-box;\n  height: 48px;\n  margin: 0;\n  padding-top: 0;\n  padding-bottom: 0;\n  border: none;\n  outline: none;\n  background: none;\n  text-align: center;\n  white-space: nowrap;\n  cursor: pointer;\n  -webkit-appearance: none;\n  z-index: 1;\n}\n.mdc-tab .mdc-tab__text-label {\n  color: rgba(0, 0, 0, 0.6);\n}\n.mdc-tab .mdc-tab__icon {\n  color: rgba(0, 0, 0, 0.54);\n  fill: currentColor;\n}\n.mdc-tab::-moz-focus-inner {\n  padding: 0;\n  border: 0;\n}\n\n.mdc-tab--min-width {\n  flex: 0 1 auto;\n}\n\n.mdc-tab__content {\n  position: relative;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  height: inherit;\n  pointer-events: none;\n}\n\n.mdc-tab__text-label,\n.mdc-tab__icon {\n  transition: 150ms color linear;\n  display: inline-block;\n  line-height: 1;\n  z-index: 2;\n}\n\n.mdc-tab--stacked {\n  height: 72px;\n}\n.mdc-tab--stacked .mdc-tab__content {\n  flex-direction: column;\n  align-items: center;\n  justify-content: space-between;\n}\n.mdc-tab--stacked .mdc-tab__icon {\n  padding-top: 12px;\n}\n.mdc-tab--stacked .mdc-tab__text-label {\n  padding-bottom: 16px;\n}\n\n.mdc-tab--active .mdc-tab__text-label {\n  color: #6200ee;\n  /* @alternate */\n  color: var(--mdc-theme-primary, #6200ee);\n}\n.mdc-tab--active .mdc-tab__icon {\n  color: #6200ee;\n  /* @alternate */\n  color: var(--mdc-theme-primary, #6200ee);\n  fill: currentColor;\n}\n.mdc-tab--active .mdc-tab__text-label,\n.mdc-tab--active .mdc-tab__icon {\n  transition-delay: 100ms;\n}\n\n.mdc-tab:not(.mdc-tab--stacked) .mdc-tab__icon + .mdc-tab__text-label {\n  /* @noflip */\n  padding-left: 8px;\n  /* @noflip */\n  padding-right: 0;\n}\n[dir=rtl] .mdc-tab:not(.mdc-tab--stacked) .mdc-tab__icon + .mdc-tab__text-label, .mdc-tab:not(.mdc-tab--stacked) .mdc-tab__icon + .mdc-tab__text-label[dir=rtl] {\n  /* @noflip */\n  padding-left: 0;\n  /* @noflip */\n  padding-right: 8px;\n}\n\n@keyframes mdc-ripple-fg-radius-in {\n  from {\n    animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1);\n    transform: translate(var(--mdc-ripple-fg-translate-start, 0)) scale(1);\n  }\n  to {\n    transform: translate(var(--mdc-ripple-fg-translate-end, 0)) scale(var(--mdc-ripple-fg-scale, 1));\n  }\n}\n@keyframes mdc-ripple-fg-opacity-in {\n  from {\n    animation-timing-function: linear;\n    opacity: 0;\n  }\n  to {\n    opacity: var(--mdc-ripple-fg-opacity, 0);\n  }\n}\n@keyframes mdc-ripple-fg-opacity-out {\n  from {\n    animation-timing-function: linear;\n    opacity: var(--mdc-ripple-fg-opacity, 0);\n  }\n  to {\n    opacity: 0;\n  }\n}\n.mdc-ripple-surface--test-edge-var-bug {\n  --mdc-ripple-surface-test-edge-var: 1px solid #000;\n  visibility: hidden;\n}\n.mdc-ripple-surface--test-edge-var-bug::before {\n  border: var(--mdc-ripple-surface-test-edge-var);\n}\n\n.mdc-tab__ripple {\n  --mdc-ripple-fg-size: 0;\n  --mdc-ripple-left: 0;\n  --mdc-ripple-top: 0;\n  --mdc-ripple-fg-scale: 1;\n  --mdc-ripple-fg-translate-end: 0;\n  --mdc-ripple-fg-translate-start: 0;\n  -webkit-tap-highlight-color: rgba(0, 0, 0, 0);\n  position: absolute;\n  top: 0;\n  left: 0;\n  width: 100%;\n  height: 100%;\n  overflow: hidden;\n}\n.mdc-tab__ripple::before, .mdc-tab__ripple::after {\n  position: absolute;\n  border-radius: 50%;\n  opacity: 0;\n  pointer-events: none;\n  content: \"\";\n}\n.mdc-tab__ripple::before {\n  transition: opacity 15ms linear, background-color 15ms linear;\n  z-index: 1;\n}\n.mdc-tab__ripple.mdc-ripple-upgraded::before {\n  transform: scale(var(--mdc-ripple-fg-scale, 1));\n}\n.mdc-tab__ripple.mdc-ripple-upgraded::after {\n  top: 0;\n  /* @noflip */\n  left: 0;\n  transform: scale(0);\n  transform-origin: center center;\n}\n.mdc-tab__ripple.mdc-ripple-upgraded--unbounded::after {\n  top: var(--mdc-ripple-top, 0);\n  /* @noflip */\n  left: var(--mdc-ripple-left, 0);\n}\n.mdc-tab__ripple.mdc-ripple-upgraded--foreground-activation::after {\n  animation: mdc-ripple-fg-radius-in 225ms forwards, mdc-ripple-fg-opacity-in 75ms forwards;\n}\n.mdc-tab__ripple.mdc-ripple-upgraded--foreground-deactivation::after {\n  animation: mdc-ripple-fg-opacity-out 150ms;\n  transform: translate(var(--mdc-ripple-fg-translate-end, 0)) scale(var(--mdc-ripple-fg-scale, 1));\n}\n.mdc-tab__ripple::before, .mdc-tab__ripple::after {\n  top: calc(50% - 100%);\n  /* @noflip */\n  left: calc(50% - 100%);\n  width: 200%;\n  height: 200%;\n}\n.mdc-tab__ripple.mdc-ripple-upgraded::after {\n  width: var(--mdc-ripple-fg-size, 100%);\n  height: var(--mdc-ripple-fg-size, 100%);\n}\n.mdc-tab__ripple::before, .mdc-tab__ripple::after {\n  background-color: #6200ee;\n}\n@supports not (-ms-ime-align: auto) {\n  .mdc-tab__ripple::before, .mdc-tab__ripple::after {\n    /* @alternate */\n    background-color: var(--mdc-theme-primary, #6200ee);\n  }\n}\n.mdc-tab__ripple:hover::before {\n  opacity: 0.04;\n}\n.mdc-tab__ripple:not(.mdc-ripple-upgraded):focus::before, .mdc-tab__ripple.mdc-ripple-upgraded--background-focused::before {\n  transition-duration: 75ms;\n  opacity: 0.12;\n}\n.mdc-tab__ripple:not(.mdc-ripple-upgraded)::after {\n  transition: opacity 150ms linear;\n}\n.mdc-tab__ripple:not(.mdc-ripple-upgraded):active::after {\n  transition-duration: 75ms;\n  opacity: 0.12;\n}\n.mdc-tab__ripple.mdc-ripple-upgraded {\n  --mdc-ripple-fg-opacity: 0.12;\n}\n\n/**\n * @license\n * Copyright 2018 Google Inc.\n *\n * Permission is hereby granted, free of charge, to any person obtaining a copy\n * of this software and associated documentation files (the \"Software\"), to deal\n * in the Software without restriction, including without limitation the rights\n * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell\n * copies of the Software, and to permit persons to whom the Software is\n * furnished to do so, subject to the following conditions:\n *\n * The above copyright notice and this permission notice shall be included in\n * all copies or substantial portions of the Software.\n *\n * THE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\n * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\n * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\n * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\n * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\n * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN\n * THE SOFTWARE.\n */\n.mdc-tab-indicator {\n  display: flex;\n  position: absolute;\n  top: 0;\n  left: 0;\n  width: 100%;\n  height: 100%;\n  pointer-events: none;\n  z-index: 1;\n}\n.mdc-tab-indicator .mdc-tab-indicator__content--underline {\n  border-color: #6200ee;\n  /* @alternate */\n  border-color: var(--mdc-theme-primary, #6200ee);\n}\n.mdc-tab-indicator .mdc-tab-indicator__content--icon {\n  color: #018786;\n  /* @alternate */\n  color: var(--mdc-theme-secondary, #018786);\n}\n.mdc-tab-indicator .mdc-tab-indicator__content--underline {\n  border-top-width: 2px;\n}\n.mdc-tab-indicator .mdc-tab-indicator__content--icon {\n  height: 34px;\n  font-size: 34px;\n}\n\n.mdc-tab-indicator__content {\n  transform-origin: left;\n  opacity: 0;\n}\n\n.mdc-tab-indicator__content--underline {\n  align-self: flex-end;\n  box-sizing: border-box;\n  width: 100%;\n  border-top-style: solid;\n}\n\n.mdc-tab-indicator__content--icon {\n  align-self: center;\n  margin: 0 auto;\n}\n\n.mdc-tab-indicator--active .mdc-tab-indicator__content {\n  opacity: 1;\n}\n\n.mdc-tab-indicator .mdc-tab-indicator__content {\n  transition: 250ms transform cubic-bezier(0.4, 0, 0.2, 1);\n}\n\n.mdc-tab-indicator--no-transition .mdc-tab-indicator__content {\n  transition: none;\n}\n\n.mdc-tab-indicator--fade .mdc-tab-indicator__content {\n  transition: 150ms opacity linear;\n}\n\n.mdc-tab-indicator--active.mdc-tab-indicator--fade .mdc-tab-indicator__content {\n  transition-delay: 100ms;\n}\n";
    styleInject(css_248z$1);

    /**
     * @license
     * Copyright 2018 Google Inc.
     *
     * Permission is hereby granted, free of charge, to any person obtaining a copy
     * of this software and associated documentation files (the "Software"), to deal
     * in the Software without restriction, including without limitation the rights
     * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
     * copies of the Software, and to permit persons to whom the Software is
     * furnished to do so, subject to the following conditions:
     *
     * The above copyright notice and this permission notice shall be included in
     * all copies or substantial portions of the Software.
     *
     * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
     * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
     * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
     * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
     * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
     * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
     * THE SOFTWARE.
     */
    var cssClasses$3 = {
        ANIMATING: 'mdc-tab-scroller--animating',
        SCROLL_AREA_SCROLL: 'mdc-tab-scroller__scroll-area--scroll',
        SCROLL_TEST: 'mdc-tab-scroller__test',
    };
    var strings$3 = {
        AREA_SELECTOR: '.mdc-tab-scroller__scroll-area',
        CONTENT_SELECTOR: '.mdc-tab-scroller__scroll-content',
    };

    /**
     * @license
     * Copyright 2018 Google Inc.
     *
     * Permission is hereby granted, free of charge, to any person obtaining a copy
     * of this software and associated documentation files (the "Software"), to deal
     * in the Software without restriction, including without limitation the rights
     * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
     * copies of the Software, and to permit persons to whom the Software is
     * furnished to do so, subject to the following conditions:
     *
     * The above copyright notice and this permission notice shall be included in
     * all copies or substantial portions of the Software.
     *
     * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
     * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
     * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
     * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
     * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
     * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
     * THE SOFTWARE.
     */
    var MDCTabScrollerRTL = /** @class */ (function () {
        function MDCTabScrollerRTL(adapter) {
            this.adapter_ = adapter;
        }
        return MDCTabScrollerRTL;
    }());

    /**
     * @license
     * Copyright 2018 Google Inc.
     *
     * Permission is hereby granted, free of charge, to any person obtaining a copy
     * of this software and associated documentation files (the "Software"), to deal
     * in the Software without restriction, including without limitation the rights
     * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
     * copies of the Software, and to permit persons to whom the Software is
     * furnished to do so, subject to the following conditions:
     *
     * The above copyright notice and this permission notice shall be included in
     * all copies or substantial portions of the Software.
     *
     * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
     * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
     * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
     * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
     * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
     * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
     * THE SOFTWARE.
     */
    var MDCTabScrollerRTLDefault = /** @class */ (function (_super) {
        __extends(MDCTabScrollerRTLDefault, _super);
        function MDCTabScrollerRTLDefault() {
            return _super !== null && _super.apply(this, arguments) || this;
        }
        MDCTabScrollerRTLDefault.prototype.getScrollPositionRTL = function () {
            var currentScrollLeft = this.adapter_.getScrollAreaScrollLeft();
            var right = this.calculateScrollEdges_().right;
            // Scroll values on most browsers are ints instead of floats so we round
            return Math.round(right - currentScrollLeft);
        };
        MDCTabScrollerRTLDefault.prototype.scrollToRTL = function (scrollX) {
            var edges = this.calculateScrollEdges_();
            var currentScrollLeft = this.adapter_.getScrollAreaScrollLeft();
            var clampedScrollLeft = this.clampScrollValue_(edges.right - scrollX);
            return {
                finalScrollPosition: clampedScrollLeft,
                scrollDelta: clampedScrollLeft - currentScrollLeft,
            };
        };
        MDCTabScrollerRTLDefault.prototype.incrementScrollRTL = function (scrollX) {
            var currentScrollLeft = this.adapter_.getScrollAreaScrollLeft();
            var clampedScrollLeft = this.clampScrollValue_(currentScrollLeft - scrollX);
            return {
                finalScrollPosition: clampedScrollLeft,
                scrollDelta: clampedScrollLeft - currentScrollLeft,
            };
        };
        MDCTabScrollerRTLDefault.prototype.getAnimatingScrollPosition = function (scrollX) {
            return scrollX;
        };
        MDCTabScrollerRTLDefault.prototype.calculateScrollEdges_ = function () {
            var contentWidth = this.adapter_.getScrollContentOffsetWidth();
            var rootWidth = this.adapter_.getScrollAreaOffsetWidth();
            return {
                left: 0,
                right: contentWidth - rootWidth,
            };
        };
        MDCTabScrollerRTLDefault.prototype.clampScrollValue_ = function (scrollX) {
            var edges = this.calculateScrollEdges_();
            return Math.min(Math.max(edges.left, scrollX), edges.right);
        };
        return MDCTabScrollerRTLDefault;
    }(MDCTabScrollerRTL));

    /**
     * @license
     * Copyright 2018 Google Inc.
     *
     * Permission is hereby granted, free of charge, to any person obtaining a copy
     * of this software and associated documentation files (the "Software"), to deal
     * in the Software without restriction, including without limitation the rights
     * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
     * copies of the Software, and to permit persons to whom the Software is
     * furnished to do so, subject to the following conditions:
     *
     * The above copyright notice and this permission notice shall be included in
     * all copies or substantial portions of the Software.
     *
     * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
     * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
     * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
     * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
     * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
     * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
     * THE SOFTWARE.
     */
    var MDCTabScrollerRTLNegative = /** @class */ (function (_super) {
        __extends(MDCTabScrollerRTLNegative, _super);
        function MDCTabScrollerRTLNegative() {
            return _super !== null && _super.apply(this, arguments) || this;
        }
        MDCTabScrollerRTLNegative.prototype.getScrollPositionRTL = function (translateX) {
            var currentScrollLeft = this.adapter_.getScrollAreaScrollLeft();
            return Math.round(translateX - currentScrollLeft);
        };
        MDCTabScrollerRTLNegative.prototype.scrollToRTL = function (scrollX) {
            var currentScrollLeft = this.adapter_.getScrollAreaScrollLeft();
            var clampedScrollLeft = this.clampScrollValue_(-scrollX);
            return {
                finalScrollPosition: clampedScrollLeft,
                scrollDelta: clampedScrollLeft - currentScrollLeft,
            };
        };
        MDCTabScrollerRTLNegative.prototype.incrementScrollRTL = function (scrollX) {
            var currentScrollLeft = this.adapter_.getScrollAreaScrollLeft();
            var clampedScrollLeft = this.clampScrollValue_(currentScrollLeft - scrollX);
            return {
                finalScrollPosition: clampedScrollLeft,
                scrollDelta: clampedScrollLeft - currentScrollLeft,
            };
        };
        MDCTabScrollerRTLNegative.prototype.getAnimatingScrollPosition = function (scrollX, translateX) {
            return scrollX - translateX;
        };
        MDCTabScrollerRTLNegative.prototype.calculateScrollEdges_ = function () {
            var contentWidth = this.adapter_.getScrollContentOffsetWidth();
            var rootWidth = this.adapter_.getScrollAreaOffsetWidth();
            return {
                left: rootWidth - contentWidth,
                right: 0,
            };
        };
        MDCTabScrollerRTLNegative.prototype.clampScrollValue_ = function (scrollX) {
            var edges = this.calculateScrollEdges_();
            return Math.max(Math.min(edges.right, scrollX), edges.left);
        };
        return MDCTabScrollerRTLNegative;
    }(MDCTabScrollerRTL));

    /**
     * @license
     * Copyright 2018 Google Inc.
     *
     * Permission is hereby granted, free of charge, to any person obtaining a copy
     * of this software and associated documentation files (the "Software"), to deal
     * in the Software without restriction, including without limitation the rights
     * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
     * copies of the Software, and to permit persons to whom the Software is
     * furnished to do so, subject to the following conditions:
     *
     * The above copyright notice and this permission notice shall be included in
     * all copies or substantial portions of the Software.
     *
     * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
     * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
     * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
     * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
     * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
     * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
     * THE SOFTWARE.
     */
    var MDCTabScrollerRTLReverse = /** @class */ (function (_super) {
        __extends(MDCTabScrollerRTLReverse, _super);
        function MDCTabScrollerRTLReverse() {
            return _super !== null && _super.apply(this, arguments) || this;
        }
        MDCTabScrollerRTLReverse.prototype.getScrollPositionRTL = function (translateX) {
            var currentScrollLeft = this.adapter_.getScrollAreaScrollLeft();
            // Scroll values on most browsers are ints instead of floats so we round
            return Math.round(currentScrollLeft - translateX);
        };
        MDCTabScrollerRTLReverse.prototype.scrollToRTL = function (scrollX) {
            var currentScrollLeft = this.adapter_.getScrollAreaScrollLeft();
            var clampedScrollLeft = this.clampScrollValue_(scrollX);
            return {
                finalScrollPosition: clampedScrollLeft,
                scrollDelta: currentScrollLeft - clampedScrollLeft,
            };
        };
        MDCTabScrollerRTLReverse.prototype.incrementScrollRTL = function (scrollX) {
            var currentScrollLeft = this.adapter_.getScrollAreaScrollLeft();
            var clampedScrollLeft = this.clampScrollValue_(currentScrollLeft + scrollX);
            return {
                finalScrollPosition: clampedScrollLeft,
                scrollDelta: currentScrollLeft - clampedScrollLeft,
            };
        };
        MDCTabScrollerRTLReverse.prototype.getAnimatingScrollPosition = function (scrollX, translateX) {
            return scrollX + translateX;
        };
        MDCTabScrollerRTLReverse.prototype.calculateScrollEdges_ = function () {
            var contentWidth = this.adapter_.getScrollContentOffsetWidth();
            var rootWidth = this.adapter_.getScrollAreaOffsetWidth();
            return {
                left: contentWidth - rootWidth,
                right: 0,
            };
        };
        MDCTabScrollerRTLReverse.prototype.clampScrollValue_ = function (scrollX) {
            var edges = this.calculateScrollEdges_();
            return Math.min(Math.max(edges.right, scrollX), edges.left);
        };
        return MDCTabScrollerRTLReverse;
    }(MDCTabScrollerRTL));

    /**
     * @license
     * Copyright 2018 Google Inc.
     *
     * Permission is hereby granted, free of charge, to any person obtaining a copy
     * of this software and associated documentation files (the "Software"), to deal
     * in the Software without restriction, including without limitation the rights
     * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
     * copies of the Software, and to permit persons to whom the Software is
     * furnished to do so, subject to the following conditions:
     *
     * The above copyright notice and this permission notice shall be included in
     * all copies or substantial portions of the Software.
     *
     * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
     * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
     * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
     * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
     * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
     * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
     * THE SOFTWARE.
     */
    var MDCTabScrollerFoundation = /** @class */ (function (_super) {
        __extends(MDCTabScrollerFoundation, _super);
        function MDCTabScrollerFoundation(adapter) {
            var _this = _super.call(this, __assign({}, MDCTabScrollerFoundation.defaultAdapter, adapter)) || this;
            /**
             * Controls whether we should handle the transitionend and interaction events during the animation.
             */
            _this.isAnimating_ = false;
            return _this;
        }
        Object.defineProperty(MDCTabScrollerFoundation, "cssClasses", {
            get: function () {
                return cssClasses$3;
            },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(MDCTabScrollerFoundation, "strings", {
            get: function () {
                return strings$3;
            },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(MDCTabScrollerFoundation, "defaultAdapter", {
            get: function () {
                // tslint:disable:object-literal-sort-keys Methods should be in the same order as the adapter interface.
                return {
                    eventTargetMatchesSelector: function () { return false; },
                    addClass: function () { return undefined; },
                    removeClass: function () { return undefined; },
                    addScrollAreaClass: function () { return undefined; },
                    setScrollAreaStyleProperty: function () { return undefined; },
                    setScrollContentStyleProperty: function () { return undefined; },
                    getScrollContentStyleValue: function () { return ''; },
                    setScrollAreaScrollLeft: function () { return undefined; },
                    getScrollAreaScrollLeft: function () { return 0; },
                    getScrollContentOffsetWidth: function () { return 0; },
                    getScrollAreaOffsetWidth: function () { return 0; },
                    computeScrollAreaClientRect: function () { return ({ top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0 }); },
                    computeScrollContentClientRect: function () { return ({ top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0 }); },
                    computeHorizontalScrollbarHeight: function () { return 0; },
                };
                // tslint:enable:object-literal-sort-keys
            },
            enumerable: true,
            configurable: true
        });
        MDCTabScrollerFoundation.prototype.init = function () {
            // Compute horizontal scrollbar height on scroller with overflow initially hidden, then update overflow to scroll
            // and immediately adjust bottom margin to avoid the scrollbar initially appearing before JS runs.
            var horizontalScrollbarHeight = this.adapter_.computeHorizontalScrollbarHeight();
            this.adapter_.setScrollAreaStyleProperty('margin-bottom', -horizontalScrollbarHeight + 'px');
            this.adapter_.addScrollAreaClass(MDCTabScrollerFoundation.cssClasses.SCROLL_AREA_SCROLL);
        };
        /**
         * Computes the current visual scroll position
         */
        MDCTabScrollerFoundation.prototype.getScrollPosition = function () {
            if (this.isRTL_()) {
                return this.computeCurrentScrollPositionRTL_();
            }
            var currentTranslateX = this.calculateCurrentTranslateX_();
            var scrollLeft = this.adapter_.getScrollAreaScrollLeft();
            return scrollLeft - currentTranslateX;
        };
        /**
         * Handles interaction events that occur during transition
         */
        MDCTabScrollerFoundation.prototype.handleInteraction = function () {
            // Early exit if we aren't animating
            if (!this.isAnimating_) {
                return;
            }
            // Prevent other event listeners from handling this event
            this.stopScrollAnimation_();
        };
        /**
         * Handles the transitionend event
         */
        MDCTabScrollerFoundation.prototype.handleTransitionEnd = function (evt) {
            // Early exit if we aren't animating or the event was triggered by a different element.
            var evtTarget = evt.target;
            if (!this.isAnimating_ ||
                !this.adapter_.eventTargetMatchesSelector(evtTarget, MDCTabScrollerFoundation.strings.CONTENT_SELECTOR)) {
                return;
            }
            this.isAnimating_ = false;
            this.adapter_.removeClass(MDCTabScrollerFoundation.cssClasses.ANIMATING);
        };
        /**
         * Increment the scroll value by the scrollXIncrement
         * @param scrollXIncrement The value by which to increment the scroll position
         */
        MDCTabScrollerFoundation.prototype.incrementScroll = function (scrollXIncrement) {
            // Early exit for non-operational increment values
            if (scrollXIncrement === 0) {
                return;
            }
            if (this.isRTL_()) {
                return this.incrementScrollRTL_(scrollXIncrement);
            }
            this.incrementScroll_(scrollXIncrement);
        };
        /**
         * Scrolls to the given scrollX value
         */
        MDCTabScrollerFoundation.prototype.scrollTo = function (scrollX) {
            if (this.isRTL_()) {
                return this.scrollToRTL_(scrollX);
            }
            this.scrollTo_(scrollX);
        };
        /**
         * @return Browser-specific {@link MDCTabScrollerRTL} instance.
         */
        MDCTabScrollerFoundation.prototype.getRTLScroller = function () {
            if (!this.rtlScrollerInstance_) {
                this.rtlScrollerInstance_ = this.rtlScrollerFactory_();
            }
            return this.rtlScrollerInstance_;
        };
        /**
         * @return translateX value from a CSS matrix transform function string.
         */
        MDCTabScrollerFoundation.prototype.calculateCurrentTranslateX_ = function () {
            var transformValue = this.adapter_.getScrollContentStyleValue('transform');
            // Early exit if no transform is present
            if (transformValue === 'none') {
                return 0;
            }
            // The transform value comes back as a matrix transformation in the form
            // of `matrix(a, b, c, d, tx, ty)`. We only care about tx (translateX) so
            // we're going to grab all the parenthesized values, strip out tx, and
            // parse it.
            var match = /\((.+?)\)/.exec(transformValue);
            if (!match) {
                return 0;
            }
            var matrixParams = match[1];
            // tslint:disable-next-line:ban-ts-ignore "Unused vars" should be a linter warning, not a compiler error.
            // @ts-ignore These unused variables should retain their semantic names for clarity.
            var _a = __read(matrixParams.split(','), 6), a = _a[0], b = _a[1], c = _a[2], d = _a[3], tx = _a[4], ty = _a[5];
            return parseFloat(tx); // tslint:disable-line:ban
        };
        /**
         * Calculates a safe scroll value that is > 0 and < the max scroll value
         * @param scrollX The distance to scroll
         */
        MDCTabScrollerFoundation.prototype.clampScrollValue_ = function (scrollX) {
            var edges = this.calculateScrollEdges_();
            return Math.min(Math.max(edges.left, scrollX), edges.right);
        };
        MDCTabScrollerFoundation.prototype.computeCurrentScrollPositionRTL_ = function () {
            var translateX = this.calculateCurrentTranslateX_();
            return this.getRTLScroller().getScrollPositionRTL(translateX);
        };
        MDCTabScrollerFoundation.prototype.calculateScrollEdges_ = function () {
            var contentWidth = this.adapter_.getScrollContentOffsetWidth();
            var rootWidth = this.adapter_.getScrollAreaOffsetWidth();
            return {
                left: 0,
                right: contentWidth - rootWidth,
            };
        };
        /**
         * Internal scroll method
         * @param scrollX The new scroll position
         */
        MDCTabScrollerFoundation.prototype.scrollTo_ = function (scrollX) {
            var currentScrollX = this.getScrollPosition();
            var safeScrollX = this.clampScrollValue_(scrollX);
            var scrollDelta = safeScrollX - currentScrollX;
            this.animate_({
                finalScrollPosition: safeScrollX,
                scrollDelta: scrollDelta,
            });
        };
        /**
         * Internal RTL scroll method
         * @param scrollX The new scroll position
         */
        MDCTabScrollerFoundation.prototype.scrollToRTL_ = function (scrollX) {
            var animation = this.getRTLScroller().scrollToRTL(scrollX);
            this.animate_(animation);
        };
        /**
         * Internal increment scroll method
         * @param scrollX The new scroll position increment
         */
        MDCTabScrollerFoundation.prototype.incrementScroll_ = function (scrollX) {
            var currentScrollX = this.getScrollPosition();
            var targetScrollX = scrollX + currentScrollX;
            var safeScrollX = this.clampScrollValue_(targetScrollX);
            var scrollDelta = safeScrollX - currentScrollX;
            this.animate_({
                finalScrollPosition: safeScrollX,
                scrollDelta: scrollDelta,
            });
        };
        /**
         * Internal increment scroll RTL method
         * @param scrollX The new scroll position RTL increment
         */
        MDCTabScrollerFoundation.prototype.incrementScrollRTL_ = function (scrollX) {
            var animation = this.getRTLScroller().incrementScrollRTL(scrollX);
            this.animate_(animation);
        };
        /**
         * Animates the tab scrolling
         * @param animation The animation to apply
         */
        MDCTabScrollerFoundation.prototype.animate_ = function (animation) {
            var _this = this;
            // Early exit if translateX is 0, which means there's no animation to perform
            if (animation.scrollDelta === 0) {
                return;
            }
            this.stopScrollAnimation_();
            // This animation uses the FLIP approach.
            // Read more here: https://aerotwist.com/blog/flip-your-animations/
            this.adapter_.setScrollAreaScrollLeft(animation.finalScrollPosition);
            this.adapter_.setScrollContentStyleProperty('transform', "translateX(" + animation.scrollDelta + "px)");
            // Force repaint
            this.adapter_.computeScrollAreaClientRect();
            requestAnimationFrame(function () {
                _this.adapter_.addClass(MDCTabScrollerFoundation.cssClasses.ANIMATING);
                _this.adapter_.setScrollContentStyleProperty('transform', 'none');
            });
            this.isAnimating_ = true;
        };
        /**
         * Stops scroll animation
         */
        MDCTabScrollerFoundation.prototype.stopScrollAnimation_ = function () {
            this.isAnimating_ = false;
            var currentScrollPosition = this.getAnimatingScrollPosition_();
            this.adapter_.removeClass(MDCTabScrollerFoundation.cssClasses.ANIMATING);
            this.adapter_.setScrollContentStyleProperty('transform', 'translateX(0px)');
            this.adapter_.setScrollAreaScrollLeft(currentScrollPosition);
        };
        /**
         * Gets the current scroll position during animation
         */
        MDCTabScrollerFoundation.prototype.getAnimatingScrollPosition_ = function () {
            var currentTranslateX = this.calculateCurrentTranslateX_();
            var scrollLeft = this.adapter_.getScrollAreaScrollLeft();
            if (this.isRTL_()) {
                return this.getRTLScroller().getAnimatingScrollPosition(scrollLeft, currentTranslateX);
            }
            return scrollLeft - currentTranslateX;
        };
        /**
         * Determines the RTL Scroller to use
         */
        MDCTabScrollerFoundation.prototype.rtlScrollerFactory_ = function () {
            // Browsers have three different implementations of scrollLeft in RTL mode,
            // dependent on the browser. The behavior is based off the max LTR
            // scrollLeft value and 0.
            //
            // * Default scrolling in RTL *
            //    - Left-most value: 0
            //    - Right-most value: Max LTR scrollLeft value
            //
            // * Negative scrolling in RTL *
            //    - Left-most value: Negated max LTR scrollLeft value
            //    - Right-most value: 0
            //
            // * Reverse scrolling in RTL *
            //    - Left-most value: Max LTR scrollLeft value
            //    - Right-most value: 0
            //
            // We use those principles below to determine which RTL scrollLeft
            // behavior is implemented in the current browser.
            var initialScrollLeft = this.adapter_.getScrollAreaScrollLeft();
            this.adapter_.setScrollAreaScrollLeft(initialScrollLeft - 1);
            var newScrollLeft = this.adapter_.getScrollAreaScrollLeft();
            // If the newScrollLeft value is negative,then we know that the browser has
            // implemented negative RTL scrolling, since all other implementations have
            // only positive values.
            if (newScrollLeft < 0) {
                // Undo the scrollLeft test check
                this.adapter_.setScrollAreaScrollLeft(initialScrollLeft);
                return new MDCTabScrollerRTLNegative(this.adapter_);
            }
            var rootClientRect = this.adapter_.computeScrollAreaClientRect();
            var contentClientRect = this.adapter_.computeScrollContentClientRect();
            var rightEdgeDelta = Math.round(contentClientRect.right - rootClientRect.right);
            // Undo the scrollLeft test check
            this.adapter_.setScrollAreaScrollLeft(initialScrollLeft);
            // By calculating the clientRect of the root element and the clientRect of
            // the content element, we can determine how much the scroll value changed
            // when we performed the scrollLeft subtraction above.
            if (rightEdgeDelta === newScrollLeft) {
                return new MDCTabScrollerRTLReverse(this.adapter_);
            }
            return new MDCTabScrollerRTLDefault(this.adapter_);
        };
        MDCTabScrollerFoundation.prototype.isRTL_ = function () {
            return this.adapter_.getScrollContentStyleValue('direction') === 'rtl';
        };
        return MDCTabScrollerFoundation;
    }(MDCFoundation));

    /**
     * @license
     * Copyright 2018 Google Inc.
     *
     * Permission is hereby granted, free of charge, to any person obtaining a copy
     * of this software and associated documentation files (the "Software"), to deal
     * in the Software without restriction, including without limitation the rights
     * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
     * copies of the Software, and to permit persons to whom the Software is
     * furnished to do so, subject to the following conditions:
     *
     * The above copyright notice and this permission notice shall be included in
     * all copies or substantial portions of the Software.
     *
     * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
     * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
     * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
     * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
     * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
     * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
     * THE SOFTWARE.
     */
    /**
     * Stores result from computeHorizontalScrollbarHeight to avoid redundant processing.
     */
    var horizontalScrollbarHeight_;
    /**
     * Computes the height of browser-rendered horizontal scrollbars using a self-created test element.
     * May return 0 (e.g. on OS X browsers under default configuration).
     */
    function computeHorizontalScrollbarHeight(documentObj, shouldCacheResult) {
        if (shouldCacheResult === void 0) { shouldCacheResult = true; }
        if (shouldCacheResult && typeof horizontalScrollbarHeight_ !== 'undefined') {
            return horizontalScrollbarHeight_;
        }
        var el = documentObj.createElement('div');
        el.classList.add(cssClasses$3.SCROLL_TEST);
        documentObj.body.appendChild(el);
        var horizontalScrollbarHeight = el.offsetHeight - el.clientHeight;
        documentObj.body.removeChild(el);
        if (shouldCacheResult) {
            horizontalScrollbarHeight_ = horizontalScrollbarHeight;
        }
        return horizontalScrollbarHeight;
    }

    /**
     * @license
     * Copyright 2018 Google Inc.
     *
     * Permission is hereby granted, free of charge, to any person obtaining a copy
     * of this software and associated documentation files (the "Software"), to deal
     * in the Software without restriction, including without limitation the rights
     * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
     * copies of the Software, and to permit persons to whom the Software is
     * furnished to do so, subject to the following conditions:
     *
     * The above copyright notice and this permission notice shall be included in
     * all copies or substantial portions of the Software.
     *
     * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
     * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
     * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
     * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
     * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
     * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
     * THE SOFTWARE.
     */
    var MDCTabScroller = /** @class */ (function (_super) {
        __extends(MDCTabScroller, _super);
        function MDCTabScroller() {
            return _super !== null && _super.apply(this, arguments) || this;
        }
        MDCTabScroller.attachTo = function (root) {
            return new MDCTabScroller(root);
        };
        MDCTabScroller.prototype.initialize = function () {
            this.area_ = this.root_.querySelector(MDCTabScrollerFoundation.strings.AREA_SELECTOR);
            this.content_ = this.root_.querySelector(MDCTabScrollerFoundation.strings.CONTENT_SELECTOR);
        };
        MDCTabScroller.prototype.initialSyncWithDOM = function () {
            var _this = this;
            this.handleInteraction_ = function () { return _this.foundation_.handleInteraction(); };
            this.handleTransitionEnd_ = function (evt) { return _this.foundation_.handleTransitionEnd(evt); };
            this.area_.addEventListener('wheel', this.handleInteraction_, applyPassive());
            this.area_.addEventListener('touchstart', this.handleInteraction_, applyPassive());
            this.area_.addEventListener('pointerdown', this.handleInteraction_, applyPassive());
            this.area_.addEventListener('mousedown', this.handleInteraction_, applyPassive());
            this.area_.addEventListener('keydown', this.handleInteraction_, applyPassive());
            this.content_.addEventListener('transitionend', this.handleTransitionEnd_);
        };
        MDCTabScroller.prototype.destroy = function () {
            _super.prototype.destroy.call(this);
            this.area_.removeEventListener('wheel', this.handleInteraction_, applyPassive());
            this.area_.removeEventListener('touchstart', this.handleInteraction_, applyPassive());
            this.area_.removeEventListener('pointerdown', this.handleInteraction_, applyPassive());
            this.area_.removeEventListener('mousedown', this.handleInteraction_, applyPassive());
            this.area_.removeEventListener('keydown', this.handleInteraction_, applyPassive());
            this.content_.removeEventListener('transitionend', this.handleTransitionEnd_);
        };
        MDCTabScroller.prototype.getDefaultFoundation = function () {
            var _this = this;
            // DO NOT INLINE this variable. For backward compatibility, foundations take a Partial<MDCFooAdapter>.
            // To ensure we don't accidentally omit any methods, we need a separate, strongly typed adapter variable.
            // tslint:disable:object-literal-sort-keys Methods should be in the same order as the adapter interface.
            var adapter = {
                eventTargetMatchesSelector: function (evtTarget, selector) { return matches(evtTarget, selector); },
                addClass: function (className) { return _this.root_.classList.add(className); },
                removeClass: function (className) { return _this.root_.classList.remove(className); },
                addScrollAreaClass: function (className) { return _this.area_.classList.add(className); },
                setScrollAreaStyleProperty: function (prop, value) { return _this.area_.style.setProperty(prop, value); },
                setScrollContentStyleProperty: function (prop, value) { return _this.content_.style.setProperty(prop, value); },
                getScrollContentStyleValue: function (propName) { return window.getComputedStyle(_this.content_).getPropertyValue(propName); },
                setScrollAreaScrollLeft: function (scrollX) { return _this.area_.scrollLeft = scrollX; },
                getScrollAreaScrollLeft: function () { return _this.area_.scrollLeft; },
                getScrollContentOffsetWidth: function () { return _this.content_.offsetWidth; },
                getScrollAreaOffsetWidth: function () { return _this.area_.offsetWidth; },
                computeScrollAreaClientRect: function () { return _this.area_.getBoundingClientRect(); },
                computeScrollContentClientRect: function () { return _this.content_.getBoundingClientRect(); },
                computeHorizontalScrollbarHeight: function () { return computeHorizontalScrollbarHeight(document); },
            };
            // tslint:enable:object-literal-sort-keys
            return new MDCTabScrollerFoundation(adapter);
        };
        /**
         * Returns the current visual scroll position
         */
        MDCTabScroller.prototype.getScrollPosition = function () {
            return this.foundation_.getScrollPosition();
        };
        /**
         * Returns the width of the scroll content
         */
        MDCTabScroller.prototype.getScrollContentWidth = function () {
            return this.content_.offsetWidth;
        };
        /**
         * Increments the scroll value by the given amount
         * @param scrollXIncrement The pixel value by which to increment the scroll value
         */
        MDCTabScroller.prototype.incrementScroll = function (scrollXIncrement) {
            this.foundation_.incrementScroll(scrollXIncrement);
        };
        /**
         * Scrolls to the given pixel position
         * @param scrollX The pixel value to scroll to
         */
        MDCTabScroller.prototype.scrollTo = function (scrollX) {
            this.foundation_.scrollTo(scrollX);
        };
        return MDCTabScroller;
    }(MDCComponent));

    /**
     * @license
     * Copyright 2018 Google Inc.
     *
     * Permission is hereby granted, free of charge, to any person obtaining a copy
     * of this software and associated documentation files (the "Software"), to deal
     * in the Software without restriction, including without limitation the rights
     * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
     * copies of the Software, and to permit persons to whom the Software is
     * furnished to do so, subject to the following conditions:
     *
     * The above copyright notice and this permission notice shall be included in
     * all copies or substantial portions of the Software.
     *
     * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
     * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
     * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
     * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
     * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
     * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
     * THE SOFTWARE.
     */
    var strings$4 = {
        ARROW_LEFT_KEY: 'ArrowLeft',
        ARROW_RIGHT_KEY: 'ArrowRight',
        END_KEY: 'End',
        ENTER_KEY: 'Enter',
        HOME_KEY: 'Home',
        SPACE_KEY: 'Space',
        TAB_ACTIVATED_EVENT: 'MDCTabBar:activated',
        TAB_SCROLLER_SELECTOR: '.mdc-tab-scroller',
        TAB_SELECTOR: '.mdc-tab',
    };
    var numbers$1 = {
        ARROW_LEFT_KEYCODE: 37,
        ARROW_RIGHT_KEYCODE: 39,
        END_KEYCODE: 35,
        ENTER_KEYCODE: 13,
        EXTRA_SCROLL_AMOUNT: 20,
        HOME_KEYCODE: 36,
        SPACE_KEYCODE: 32,
    };

    /**
     * @license
     * Copyright 2018 Google Inc.
     *
     * Permission is hereby granted, free of charge, to any person obtaining a copy
     * of this software and associated documentation files (the "Software"), to deal
     * in the Software without restriction, including without limitation the rights
     * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
     * copies of the Software, and to permit persons to whom the Software is
     * furnished to do so, subject to the following conditions:
     *
     * The above copyright notice and this permission notice shall be included in
     * all copies or substantial portions of the Software.
     *
     * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
     * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
     * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
     * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
     * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
     * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
     * THE SOFTWARE.
     */
    var ACCEPTABLE_KEYS = new Set();
    // IE11 has no support for new Set with iterable so we need to initialize this by hand
    ACCEPTABLE_KEYS.add(strings$4.ARROW_LEFT_KEY);
    ACCEPTABLE_KEYS.add(strings$4.ARROW_RIGHT_KEY);
    ACCEPTABLE_KEYS.add(strings$4.END_KEY);
    ACCEPTABLE_KEYS.add(strings$4.HOME_KEY);
    ACCEPTABLE_KEYS.add(strings$4.ENTER_KEY);
    ACCEPTABLE_KEYS.add(strings$4.SPACE_KEY);
    var KEYCODE_MAP = new Map();
    // IE11 has no support for new Map with iterable so we need to initialize this by hand
    KEYCODE_MAP.set(numbers$1.ARROW_LEFT_KEYCODE, strings$4.ARROW_LEFT_KEY);
    KEYCODE_MAP.set(numbers$1.ARROW_RIGHT_KEYCODE, strings$4.ARROW_RIGHT_KEY);
    KEYCODE_MAP.set(numbers$1.END_KEYCODE, strings$4.END_KEY);
    KEYCODE_MAP.set(numbers$1.HOME_KEYCODE, strings$4.HOME_KEY);
    KEYCODE_MAP.set(numbers$1.ENTER_KEYCODE, strings$4.ENTER_KEY);
    KEYCODE_MAP.set(numbers$1.SPACE_KEYCODE, strings$4.SPACE_KEY);
    var MDCTabBarFoundation = /** @class */ (function (_super) {
        __extends(MDCTabBarFoundation, _super);
        function MDCTabBarFoundation(adapter) {
            var _this = _super.call(this, __assign({}, MDCTabBarFoundation.defaultAdapter, adapter)) || this;
            _this.useAutomaticActivation_ = false;
            return _this;
        }
        Object.defineProperty(MDCTabBarFoundation, "strings", {
            get: function () {
                return strings$4;
            },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(MDCTabBarFoundation, "numbers", {
            get: function () {
                return numbers$1;
            },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(MDCTabBarFoundation, "defaultAdapter", {
            get: function () {
                // tslint:disable:object-literal-sort-keys Methods should be in the same order as the adapter interface.
                return {
                    scrollTo: function () { return undefined; },
                    incrementScroll: function () { return undefined; },
                    getScrollPosition: function () { return 0; },
                    getScrollContentWidth: function () { return 0; },
                    getOffsetWidth: function () { return 0; },
                    isRTL: function () { return false; },
                    setActiveTab: function () { return undefined; },
                    activateTabAtIndex: function () { return undefined; },
                    deactivateTabAtIndex: function () { return undefined; },
                    focusTabAtIndex: function () { return undefined; },
                    getTabIndicatorClientRectAtIndex: function () { return ({ top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0 }); },
                    getTabDimensionsAtIndex: function () { return ({ rootLeft: 0, rootRight: 0, contentLeft: 0, contentRight: 0 }); },
                    getPreviousActiveTabIndex: function () { return -1; },
                    getFocusedTabIndex: function () { return -1; },
                    getIndexOfTabById: function () { return -1; },
                    getTabListLength: function () { return 0; },
                    notifyTabActivated: function () { return undefined; },
                };
                // tslint:enable:object-literal-sort-keys
            },
            enumerable: true,
            configurable: true
        });
        /**
         * Switches between automatic and manual activation modes.
         * See https://www.w3.org/TR/wai-aria-practices/#tabpanel for examples.
         */
        MDCTabBarFoundation.prototype.setUseAutomaticActivation = function (useAutomaticActivation) {
            this.useAutomaticActivation_ = useAutomaticActivation;
        };
        MDCTabBarFoundation.prototype.activateTab = function (index) {
            var previousActiveIndex = this.adapter_.getPreviousActiveTabIndex();
            if (!this.indexIsInRange_(index) || index === previousActiveIndex) {
                return;
            }
            var previousClientRect;
            if (previousActiveIndex !== -1) {
                this.adapter_.deactivateTabAtIndex(previousActiveIndex);
                previousClientRect = this.adapter_.getTabIndicatorClientRectAtIndex(previousActiveIndex);
            }
            this.adapter_.activateTabAtIndex(index, previousClientRect);
            this.scrollIntoView(index);
            this.adapter_.notifyTabActivated(index);
        };
        MDCTabBarFoundation.prototype.handleKeyDown = function (evt) {
            // Get the key from the event
            var key = this.getKeyFromEvent_(evt);
            // Early exit if the event key isn't one of the keyboard navigation keys
            if (key === undefined) {
                return;
            }
            // Prevent default behavior for movement keys, but not for activation keys, since :active is used to apply ripple
            if (!this.isActivationKey_(key)) {
                evt.preventDefault();
            }
            if (this.useAutomaticActivation_) {
                if (this.isActivationKey_(key)) {
                    return;
                }
                var index = this.determineTargetFromKey_(this.adapter_.getPreviousActiveTabIndex(), key);
                this.adapter_.setActiveTab(index);
                this.scrollIntoView(index);
            }
            else {
                var focusedTabIndex = this.adapter_.getFocusedTabIndex();
                if (this.isActivationKey_(key)) {
                    this.adapter_.setActiveTab(focusedTabIndex);
                }
                else {
                    var index = this.determineTargetFromKey_(focusedTabIndex, key);
                    this.adapter_.focusTabAtIndex(index);
                    this.scrollIntoView(index);
                }
            }
        };
        /**
         * Handles the MDCTab:interacted event
         */
        MDCTabBarFoundation.prototype.handleTabInteraction = function (evt) {
            this.adapter_.setActiveTab(this.adapter_.getIndexOfTabById(evt.detail.tabId));
        };
        /**
         * Scrolls the tab at the given index into view
         * @param index The tab index to make visible
         */
        MDCTabBarFoundation.prototype.scrollIntoView = function (index) {
            // Early exit if the index is out of range
            if (!this.indexIsInRange_(index)) {
                return;
            }
            // Always scroll to 0 if scrolling to the 0th index
            if (index === 0) {
                return this.adapter_.scrollTo(0);
            }
            // Always scroll to the max value if scrolling to the Nth index
            // MDCTabScroller.scrollTo() will never scroll past the max possible value
            if (index === this.adapter_.getTabListLength() - 1) {
                return this.adapter_.scrollTo(this.adapter_.getScrollContentWidth());
            }
            if (this.isRTL_()) {
                return this.scrollIntoViewRTL_(index);
            }
            this.scrollIntoView_(index);
        };
        /**
         * Private method for determining the index of the destination tab based on what key was pressed
         * @param origin The original index from which to determine the destination
         * @param key The name of the key
         */
        MDCTabBarFoundation.prototype.determineTargetFromKey_ = function (origin, key) {
            var isRTL = this.isRTL_();
            var maxIndex = this.adapter_.getTabListLength() - 1;
            var shouldGoToEnd = key === strings$4.END_KEY;
            var shouldDecrement = key === strings$4.ARROW_LEFT_KEY && !isRTL || key === strings$4.ARROW_RIGHT_KEY && isRTL;
            var shouldIncrement = key === strings$4.ARROW_RIGHT_KEY && !isRTL || key === strings$4.ARROW_LEFT_KEY && isRTL;
            var index = origin;
            if (shouldGoToEnd) {
                index = maxIndex;
            }
            else if (shouldDecrement) {
                index -= 1;
            }
            else if (shouldIncrement) {
                index += 1;
            }
            else {
                index = 0;
            }
            if (index < 0) {
                index = maxIndex;
            }
            else if (index > maxIndex) {
                index = 0;
            }
            return index;
        };
        /**
         * Calculates the scroll increment that will make the tab at the given index visible
         * @param index The index of the tab
         * @param nextIndex The index of the next tab
         * @param scrollPosition The current scroll position
         * @param barWidth The width of the Tab Bar
         */
        MDCTabBarFoundation.prototype.calculateScrollIncrement_ = function (index, nextIndex, scrollPosition, barWidth) {
            var nextTabDimensions = this.adapter_.getTabDimensionsAtIndex(nextIndex);
            var relativeContentLeft = nextTabDimensions.contentLeft - scrollPosition - barWidth;
            var relativeContentRight = nextTabDimensions.contentRight - scrollPosition;
            var leftIncrement = relativeContentRight - numbers$1.EXTRA_SCROLL_AMOUNT;
            var rightIncrement = relativeContentLeft + numbers$1.EXTRA_SCROLL_AMOUNT;
            if (nextIndex < index) {
                return Math.min(leftIncrement, 0);
            }
            return Math.max(rightIncrement, 0);
        };
        /**
         * Calculates the scroll increment that will make the tab at the given index visible in RTL
         * @param index The index of the tab
         * @param nextIndex The index of the next tab
         * @param scrollPosition The current scroll position
         * @param barWidth The width of the Tab Bar
         * @param scrollContentWidth The width of the scroll content
         */
        MDCTabBarFoundation.prototype.calculateScrollIncrementRTL_ = function (index, nextIndex, scrollPosition, barWidth, scrollContentWidth) {
            var nextTabDimensions = this.adapter_.getTabDimensionsAtIndex(nextIndex);
            var relativeContentLeft = scrollContentWidth - nextTabDimensions.contentLeft - scrollPosition;
            var relativeContentRight = scrollContentWidth - nextTabDimensions.contentRight - scrollPosition - barWidth;
            var leftIncrement = relativeContentRight + numbers$1.EXTRA_SCROLL_AMOUNT;
            var rightIncrement = relativeContentLeft - numbers$1.EXTRA_SCROLL_AMOUNT;
            if (nextIndex > index) {
                return Math.max(leftIncrement, 0);
            }
            return Math.min(rightIncrement, 0);
        };
        /**
         * Determines the index of the adjacent tab closest to either edge of the Tab Bar
         * @param index The index of the tab
         * @param tabDimensions The dimensions of the tab
         * @param scrollPosition The current scroll position
         * @param barWidth The width of the tab bar
         */
        MDCTabBarFoundation.prototype.findAdjacentTabIndexClosestToEdge_ = function (index, tabDimensions, scrollPosition, barWidth) {
            /**
             * Tabs are laid out in the Tab Scroller like this:
             *
             *    Scroll Position
             *    +---+
             *    |   |   Bar Width
             *    |   +-----------------------------------+
             *    |   |                                   |
             *    |   V                                   V
             *    |   +-----------------------------------+
             *    V   |             Tab Scroller          |
             *    +------------+--------------+-------------------+
             *    |    Tab     |      Tab     |        Tab        |
             *    +------------+--------------+-------------------+
             *        |                                   |
             *        +-----------------------------------+
             *
             * To determine the next adjacent index, we look at the Tab root left and
             * Tab root right, both relative to the scroll position. If the Tab root
             * left is less than 0, then we know it's out of view to the left. If the
             * Tab root right minus the bar width is greater than 0, we know the Tab is
             * out of view to the right. From there, we either increment or decrement
             * the index.
             */
            var relativeRootLeft = tabDimensions.rootLeft - scrollPosition;
            var relativeRootRight = tabDimensions.rootRight - scrollPosition - barWidth;
            var relativeRootDelta = relativeRootLeft + relativeRootRight;
            var leftEdgeIsCloser = relativeRootLeft < 0 || relativeRootDelta < 0;
            var rightEdgeIsCloser = relativeRootRight > 0 || relativeRootDelta > 0;
            if (leftEdgeIsCloser) {
                return index - 1;
            }
            if (rightEdgeIsCloser) {
                return index + 1;
            }
            return -1;
        };
        /**
         * Determines the index of the adjacent tab closest to either edge of the Tab Bar in RTL
         * @param index The index of the tab
         * @param tabDimensions The dimensions of the tab
         * @param scrollPosition The current scroll position
         * @param barWidth The width of the tab bar
         * @param scrollContentWidth The width of the scroller content
         */
        MDCTabBarFoundation.prototype.findAdjacentTabIndexClosestToEdgeRTL_ = function (index, tabDimensions, scrollPosition, barWidth, scrollContentWidth) {
            var rootLeft = scrollContentWidth - tabDimensions.rootLeft - barWidth - scrollPosition;
            var rootRight = scrollContentWidth - tabDimensions.rootRight - scrollPosition;
            var rootDelta = rootLeft + rootRight;
            var leftEdgeIsCloser = rootLeft > 0 || rootDelta > 0;
            var rightEdgeIsCloser = rootRight < 0 || rootDelta < 0;
            if (leftEdgeIsCloser) {
                return index + 1;
            }
            if (rightEdgeIsCloser) {
                return index - 1;
            }
            return -1;
        };
        /**
         * Returns the key associated with a keydown event
         * @param evt The keydown event
         */
        MDCTabBarFoundation.prototype.getKeyFromEvent_ = function (evt) {
            if (ACCEPTABLE_KEYS.has(evt.key)) {
                return evt.key;
            }
            return KEYCODE_MAP.get(evt.keyCode);
        };
        MDCTabBarFoundation.prototype.isActivationKey_ = function (key) {
            return key === strings$4.SPACE_KEY || key === strings$4.ENTER_KEY;
        };
        /**
         * Returns whether a given index is inclusively between the ends
         * @param index The index to test
         */
        MDCTabBarFoundation.prototype.indexIsInRange_ = function (index) {
            return index >= 0 && index < this.adapter_.getTabListLength();
        };
        /**
         * Returns the view's RTL property
         */
        MDCTabBarFoundation.prototype.isRTL_ = function () {
            return this.adapter_.isRTL();
        };
        /**
         * Scrolls the tab at the given index into view for left-to-right user agents.
         * @param index The index of the tab to scroll into view
         */
        MDCTabBarFoundation.prototype.scrollIntoView_ = function (index) {
            var scrollPosition = this.adapter_.getScrollPosition();
            var barWidth = this.adapter_.getOffsetWidth();
            var tabDimensions = this.adapter_.getTabDimensionsAtIndex(index);
            var nextIndex = this.findAdjacentTabIndexClosestToEdge_(index, tabDimensions, scrollPosition, barWidth);
            if (!this.indexIsInRange_(nextIndex)) {
                return;
            }
            var scrollIncrement = this.calculateScrollIncrement_(index, nextIndex, scrollPosition, barWidth);
            this.adapter_.incrementScroll(scrollIncrement);
        };
        /**
         * Scrolls the tab at the given index into view in RTL
         * @param index The tab index to make visible
         */
        MDCTabBarFoundation.prototype.scrollIntoViewRTL_ = function (index) {
            var scrollPosition = this.adapter_.getScrollPosition();
            var barWidth = this.adapter_.getOffsetWidth();
            var tabDimensions = this.adapter_.getTabDimensionsAtIndex(index);
            var scrollWidth = this.adapter_.getScrollContentWidth();
            var nextIndex = this.findAdjacentTabIndexClosestToEdgeRTL_(index, tabDimensions, scrollPosition, barWidth, scrollWidth);
            if (!this.indexIsInRange_(nextIndex)) {
                return;
            }
            var scrollIncrement = this.calculateScrollIncrementRTL_(index, nextIndex, scrollPosition, barWidth, scrollWidth);
            this.adapter_.incrementScroll(scrollIncrement);
        };
        return MDCTabBarFoundation;
    }(MDCFoundation));

    /**
     * @license
     * Copyright 2018 Google Inc.
     *
     * Permission is hereby granted, free of charge, to any person obtaining a copy
     * of this software and associated documentation files (the "Software"), to deal
     * in the Software without restriction, including without limitation the rights
     * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
     * copies of the Software, and to permit persons to whom the Software is
     * furnished to do so, subject to the following conditions:
     *
     * The above copyright notice and this permission notice shall be included in
     * all copies or substantial portions of the Software.
     *
     * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
     * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
     * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
     * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
     * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
     * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
     * THE SOFTWARE.
     */
    var strings$5 = MDCTabBarFoundation.strings;
    var tabIdCounter = 0;
    var MDCTabBar = /** @class */ (function (_super) {
        __extends(MDCTabBar, _super);
        function MDCTabBar() {
            return _super !== null && _super.apply(this, arguments) || this;
        }
        MDCTabBar.attachTo = function (root) {
            return new MDCTabBar(root);
        };
        Object.defineProperty(MDCTabBar.prototype, "focusOnActivate", {
            set: function (focusOnActivate) {
                this.tabList_.forEach(function (tab) { return tab.focusOnActivate = focusOnActivate; });
            },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(MDCTabBar.prototype, "useAutomaticActivation", {
            set: function (useAutomaticActivation) {
                this.foundation_.setUseAutomaticActivation(useAutomaticActivation);
            },
            enumerable: true,
            configurable: true
        });
        MDCTabBar.prototype.initialize = function (tabFactory, tabScrollerFactory) {
            if (tabFactory === void 0) { tabFactory = function (el) { return new MDCTab(el); }; }
            if (tabScrollerFactory === void 0) { tabScrollerFactory = function (el) { return new MDCTabScroller(el); }; }
            this.tabList_ = this.instantiateTabs_(tabFactory);
            this.tabScroller_ = this.instantiateTabScroller_(tabScrollerFactory);
        };
        MDCTabBar.prototype.initialSyncWithDOM = function () {
            var _this = this;
            this.handleTabInteraction_ = function (evt) { return _this.foundation_.handleTabInteraction(evt); };
            this.handleKeyDown_ = function (evt) { return _this.foundation_.handleKeyDown(evt); };
            this.listen(MDCTabFoundation.strings.INTERACTED_EVENT, this.handleTabInteraction_);
            this.listen('keydown', this.handleKeyDown_);
            for (var i = 0; i < this.tabList_.length; i++) {
                if (this.tabList_[i].active) {
                    this.scrollIntoView(i);
                    break;
                }
            }
        };
        MDCTabBar.prototype.destroy = function () {
            _super.prototype.destroy.call(this);
            this.unlisten(MDCTabFoundation.strings.INTERACTED_EVENT, this.handleTabInteraction_);
            this.unlisten('keydown', this.handleKeyDown_);
            this.tabList_.forEach(function (tab) { return tab.destroy(); });
            if (this.tabScroller_) {
                this.tabScroller_.destroy();
            }
        };
        MDCTabBar.prototype.getDefaultFoundation = function () {
            var _this = this;
            // DO NOT INLINE this variable. For backward compatibility, foundations take a Partial<MDCFooAdapter>.
            // To ensure we don't accidentally omit any methods, we need a separate, strongly typed adapter variable.
            // tslint:disable:object-literal-sort-keys Methods should be in the same order as the adapter interface.
            var adapter = {
                scrollTo: function (scrollX) { return _this.tabScroller_.scrollTo(scrollX); },
                incrementScroll: function (scrollXIncrement) { return _this.tabScroller_.incrementScroll(scrollXIncrement); },
                getScrollPosition: function () { return _this.tabScroller_.getScrollPosition(); },
                getScrollContentWidth: function () { return _this.tabScroller_.getScrollContentWidth(); },
                getOffsetWidth: function () { return _this.root_.offsetWidth; },
                isRTL: function () { return window.getComputedStyle(_this.root_).getPropertyValue('direction') === 'rtl'; },
                setActiveTab: function (index) { return _this.foundation_.activateTab(index); },
                activateTabAtIndex: function (index, clientRect) { return _this.tabList_[index].activate(clientRect); },
                deactivateTabAtIndex: function (index) { return _this.tabList_[index].deactivate(); },
                focusTabAtIndex: function (index) { return _this.tabList_[index].focus(); },
                getTabIndicatorClientRectAtIndex: function (index) { return _this.tabList_[index].computeIndicatorClientRect(); },
                getTabDimensionsAtIndex: function (index) { return _this.tabList_[index].computeDimensions(); },
                getPreviousActiveTabIndex: function () {
                    for (var i = 0; i < _this.tabList_.length; i++) {
                        if (_this.tabList_[i].active) {
                            return i;
                        }
                    }
                    return -1;
                },
                getFocusedTabIndex: function () {
                    var tabElements = _this.getTabElements_();
                    var activeElement = document.activeElement;
                    return tabElements.indexOf(activeElement);
                },
                getIndexOfTabById: function (id) {
                    for (var i = 0; i < _this.tabList_.length; i++) {
                        if (_this.tabList_[i].id === id) {
                            return i;
                        }
                    }
                    return -1;
                },
                getTabListLength: function () { return _this.tabList_.length; },
                notifyTabActivated: function (index) {
                    return _this.emit(strings$5.TAB_ACTIVATED_EVENT, { index: index }, true);
                },
            };
            // tslint:enable:object-literal-sort-keys
            return new MDCTabBarFoundation(adapter);
        };
        /**
         * Activates the tab at the given index
         * @param index The index of the tab
         */
        MDCTabBar.prototype.activateTab = function (index) {
            this.foundation_.activateTab(index);
        };
        /**
         * Scrolls the tab at the given index into view
         * @param index THe index of the tab
         */
        MDCTabBar.prototype.scrollIntoView = function (index) {
            this.foundation_.scrollIntoView(index);
        };
        /**
         * Returns all the tab elements in a nice clean array
         */
        MDCTabBar.prototype.getTabElements_ = function () {
            return [].slice.call(this.root_.querySelectorAll(strings$5.TAB_SELECTOR));
        };
        /**
         * Instantiates tab components on all child tab elements
         */
        MDCTabBar.prototype.instantiateTabs_ = function (tabFactory) {
            return this.getTabElements_().map(function (el) {
                el.id = el.id || "mdc-tab-" + ++tabIdCounter;
                return tabFactory(el);
            });
        };
        /**
         * Instantiates tab scroller component on the child tab scroller element
         */
        MDCTabBar.prototype.instantiateTabScroller_ = function (tabScrollerFactory) {
            var tabScrollerElement = this.root_.querySelector(strings$5.TAB_SCROLLER_SELECTOR);
            if (tabScrollerElement) {
                return tabScrollerFactory(tabScrollerElement);
            }
            return null;
        };
        return MDCTabBar;
    }(MDCComponent));

    /* node_modules\@smui\tab-scroller\TabScroller.svelte generated by Svelte v3.24.1 */

    function create_fragment$4(ctx) {
    	let div2;
    	let div1;
    	let div0;
    	let div0_class_value;
    	let useActions_action;
    	let div1_class_value;
    	let useActions_action_1;
    	let div2_class_value;
    	let useActions_action_2;
    	let forwardEvents_action;
    	let current;
    	let mounted;
    	let dispose;
    	const default_slot_template = /*$$slots*/ ctx[14].default;
    	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[13], null);

    	let div0_levels = [
    		{
    			class: div0_class_value = "mdc-tab-scroller__scroll-content " + /*scrollContent$class*/ ctx[5]
    		},
    		exclude(prefixFilter(/*$$props*/ ctx[8], "scrollContent$"), ["use", "class"])
    	];

    	let div0_data = {};

    	for (let i = 0; i < div0_levels.length; i += 1) {
    		div0_data = assign(div0_data, div0_levels[i]);
    	}

    	let div1_levels = [
    		{
    			class: div1_class_value = "mdc-tab-scroller__scroll-area " + /*scrollArea$class*/ ctx[3]
    		},
    		exclude(prefixFilter(/*$$props*/ ctx[8], "scrollArea$"), ["use", "class"])
    	];

    	let div1_data = {};

    	for (let i = 0; i < div1_levels.length; i += 1) {
    		div1_data = assign(div1_data, div1_levels[i]);
    	}

    	let div2_levels = [
    		{
    			class: div2_class_value = "mdc-tab-scroller " + /*className*/ ctx[1]
    		},
    		exclude(/*$$props*/ ctx[8], ["use", "class", "scrollArea$", "scrollContent$"])
    	];

    	let div2_data = {};

    	for (let i = 0; i < div2_levels.length; i += 1) {
    		div2_data = assign(div2_data, div2_levels[i]);
    	}

    	return {
    		c() {
    			div2 = element("div");
    			div1 = element("div");
    			div0 = element("div");
    			if (default_slot) default_slot.c();
    			set_attributes(div0, div0_data);
    			set_attributes(div1, div1_data);
    			set_attributes(div2, div2_data);
    		},
    		m(target, anchor) {
    			insert(target, div2, anchor);
    			append(div2, div1);
    			append(div1, div0);

    			if (default_slot) {
    				default_slot.m(div0, null);
    			}

    			/*div2_binding*/ ctx[15](div2);
    			current = true;

    			if (!mounted) {
    				dispose = [
    					action_destroyer(useActions_action = useActions.call(null, div0, /*scrollContent$use*/ ctx[4])),
    					action_destroyer(useActions_action_1 = useActions.call(null, div1, /*scrollArea$use*/ ctx[2])),
    					action_destroyer(useActions_action_2 = useActions.call(null, div2, /*use*/ ctx[0])),
    					action_destroyer(forwardEvents_action = /*forwardEvents*/ ctx[7].call(null, div2))
    				];

    				mounted = true;
    			}
    		},
    		p(ctx, [dirty]) {
    			if (default_slot) {
    				if (default_slot.p && dirty & /*$$scope*/ 8192) {
    					update_slot(default_slot, default_slot_template, ctx, /*$$scope*/ ctx[13], dirty, null, null);
    				}
    			}

    			set_attributes(div0, div0_data = get_spread_update(div0_levels, [
    				(!current || dirty & /*scrollContent$class*/ 32 && div0_class_value !== (div0_class_value = "mdc-tab-scroller__scroll-content " + /*scrollContent$class*/ ctx[5])) && { class: div0_class_value },
    				dirty & /*$$props*/ 256 && exclude(prefixFilter(/*$$props*/ ctx[8], "scrollContent$"), ["use", "class"])
    			]));

    			if (useActions_action && is_function(useActions_action.update) && dirty & /*scrollContent$use*/ 16) useActions_action.update.call(null, /*scrollContent$use*/ ctx[4]);

    			set_attributes(div1, div1_data = get_spread_update(div1_levels, [
    				(!current || dirty & /*scrollArea$class*/ 8 && div1_class_value !== (div1_class_value = "mdc-tab-scroller__scroll-area " + /*scrollArea$class*/ ctx[3])) && { class: div1_class_value },
    				dirty & /*$$props*/ 256 && exclude(prefixFilter(/*$$props*/ ctx[8], "scrollArea$"), ["use", "class"])
    			]));

    			if (useActions_action_1 && is_function(useActions_action_1.update) && dirty & /*scrollArea$use*/ 4) useActions_action_1.update.call(null, /*scrollArea$use*/ ctx[2]);

    			set_attributes(div2, div2_data = get_spread_update(div2_levels, [
    				(!current || dirty & /*className*/ 2 && div2_class_value !== (div2_class_value = "mdc-tab-scroller " + /*className*/ ctx[1])) && { class: div2_class_value },
    				dirty & /*$$props*/ 256 && exclude(/*$$props*/ ctx[8], ["use", "class", "scrollArea$", "scrollContent$"])
    			]));

    			if (useActions_action_2 && is_function(useActions_action_2.update) && dirty & /*use*/ 1) useActions_action_2.update.call(null, /*use*/ ctx[0]);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(default_slot, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(default_slot, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(div2);
    			if (default_slot) default_slot.d(detaching);
    			/*div2_binding*/ ctx[15](null);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    function instance$4($$self, $$props, $$invalidate) {
    	const forwardEvents = forwardEventsBuilder(get_current_component());
    	let { use = [] } = $$props;
    	let { class: className = "" } = $$props;
    	let { scrollArea$use = [] } = $$props;
    	let { scrollArea$class = "" } = $$props;
    	let { scrollContent$use = [] } = $$props;
    	let { scrollContent$class = "" } = $$props;
    	let element;
    	let tabScroller;
    	let instantiate = getContext("SMUI:tab-scroller:instantiate");
    	let getInstance = getContext("SMUI:tab-scroller:getInstance");

    	onMount(async () => {
    		if (instantiate !== false) {
    			tabScroller = new MDCTabScroller(element);
    		} else {
    			tabScroller = await getInstance();
    		}
    	});

    	onDestroy(() => {
    		tabScroller && tabScroller.destroy();
    	});

    	function scrollTo(...args) {
    		return tabScroller.scrollTo(...args);
    	}

    	function incrementScroll(...args) {
    		return tabScroller.incrementScroll(...args);
    	}

    	function getScrollPosition(...args) {
    		return tabScroller.getScrollPosition(...args);
    	}

    	function getScrollContentWidth(...args) {
    		return tabScroller.getScrollContentWidth(...args);
    	}

    	let { $$slots = {}, $$scope } = $$props;

    	function div2_binding($$value) {
    		binding_callbacks[$$value ? "unshift" : "push"](() => {
    			element = $$value;
    			$$invalidate(6, element);
    		});
    	}

    	$$self.$$set = $$new_props => {
    		$$invalidate(8, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
    		if ("use" in $$new_props) $$invalidate(0, use = $$new_props.use);
    		if ("class" in $$new_props) $$invalidate(1, className = $$new_props.class);
    		if ("scrollArea$use" in $$new_props) $$invalidate(2, scrollArea$use = $$new_props.scrollArea$use);
    		if ("scrollArea$class" in $$new_props) $$invalidate(3, scrollArea$class = $$new_props.scrollArea$class);
    		if ("scrollContent$use" in $$new_props) $$invalidate(4, scrollContent$use = $$new_props.scrollContent$use);
    		if ("scrollContent$class" in $$new_props) $$invalidate(5, scrollContent$class = $$new_props.scrollContent$class);
    		if ("$$scope" in $$new_props) $$invalidate(13, $$scope = $$new_props.$$scope);
    	};

    	$$props = exclude_internal_props($$props);

    	return [
    		use,
    		className,
    		scrollArea$use,
    		scrollArea$class,
    		scrollContent$use,
    		scrollContent$class,
    		element,
    		forwardEvents,
    		$$props,
    		scrollTo,
    		incrementScroll,
    		getScrollPosition,
    		getScrollContentWidth,
    		$$scope,
    		$$slots,
    		div2_binding
    	];
    }

    class TabScroller extends SvelteComponent {
    	constructor(options) {
    		super();

    		init(this, options, instance$4, create_fragment$4, safe_not_equal, {
    			use: 0,
    			class: 1,
    			scrollArea$use: 2,
    			scrollArea$class: 3,
    			scrollContent$use: 4,
    			scrollContent$class: 5,
    			scrollTo: 9,
    			incrementScroll: 10,
    			getScrollPosition: 11,
    			getScrollContentWidth: 12
    		});
    	}

    	get scrollTo() {
    		return this.$$.ctx[9];
    	}

    	get incrementScroll() {
    		return this.$$.ctx[10];
    	}

    	get getScrollPosition() {
    		return this.$$.ctx[11];
    	}

    	get getScrollContentWidth() {
    		return this.$$.ctx[12];
    	}
    }

    /* node_modules\@smui\tab-bar\TabBar.svelte generated by Svelte v3.24.1 */
    const get_default_slot_changes = dirty => ({ tab: dirty & /*tabs*/ 4 });
    const get_default_slot_context = ctx => ({ tab: /*tab*/ ctx[28] });

    function get_each_context(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[28] = list[i];
    	child_ctx[30] = i;
    	return child_ctx;
    }

    // (13:4) {#each tabs as tab, i (key(tab))}
    function create_each_block(key_2, ctx) {
    	let first;
    	let current;
    	const default_slot_template = /*$$slots*/ ctx[14].default;
    	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[16], get_default_slot_context);

    	return {
    		key: key_2,
    		first: null,
    		c() {
    			first = empty();
    			if (default_slot) default_slot.c();
    			this.first = first;
    		},
    		m(target, anchor) {
    			insert(target, first, anchor);

    			if (default_slot) {
    				default_slot.m(target, anchor);
    			}

    			current = true;
    		},
    		p(ctx, dirty) {
    			if (default_slot) {
    				if (default_slot.p && dirty & /*$$scope, tabs*/ 65540) {
    					update_slot(default_slot, default_slot_template, ctx, /*$$scope*/ ctx[16], dirty, get_default_slot_changes, get_default_slot_context);
    				}
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(default_slot, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(default_slot, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(first);
    			if (default_slot) default_slot.d(detaching);
    		}
    	};
    }

    // (10:2) <TabScroller     {...prefixFilter($$props, 'tabScroller$')}   >
    function create_default_slot$1(ctx) {
    	let each_blocks = [];
    	let each_1_lookup = new Map();
    	let each_1_anchor;
    	let current;
    	let each_value = /*tabs*/ ctx[2];
    	const get_key = ctx => /*key*/ ctx[3](/*tab*/ ctx[28]);

    	for (let i = 0; i < each_value.length; i += 1) {
    		let child_ctx = get_each_context(ctx, each_value, i);
    		let key = get_key(child_ctx);
    		each_1_lookup.set(key, each_blocks[i] = create_each_block(key, child_ctx));
    	}

    	return {
    		c() {
    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			each_1_anchor = empty();
    		},
    		m(target, anchor) {
    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(target, anchor);
    			}

    			insert(target, each_1_anchor, anchor);
    			current = true;
    		},
    		p(ctx, dirty) {
    			if (dirty & /*$$scope, tabs*/ 65540) {
    				const each_value = /*tabs*/ ctx[2];
    				group_outros();
    				each_blocks = update_keyed_each(each_blocks, dirty, get_key, 1, ctx, each_value, each_1_lookup, each_1_anchor.parentNode, outro_and_destroy_block, create_each_block, each_1_anchor, get_each_context);
    				check_outros();
    			}
    		},
    		i(local) {
    			if (current) return;

    			for (let i = 0; i < each_value.length; i += 1) {
    				transition_in(each_blocks[i]);
    			}

    			current = true;
    		},
    		o(local) {
    			for (let i = 0; i < each_blocks.length; i += 1) {
    				transition_out(each_blocks[i]);
    			}

    			current = false;
    		},
    		d(detaching) {
    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].d(detaching);
    			}

    			if (detaching) detach(each_1_anchor);
    		}
    	};
    }

    function create_fragment$5(ctx) {
    	let div;
    	let tabscroller;
    	let div_class_value;
    	let useActions_action;
    	let forwardEvents_action;
    	let current;
    	let mounted;
    	let dispose;
    	const tabscroller_spread_levels = [prefixFilter(/*$$props*/ ctx[7], "tabScroller$")];

    	let tabscroller_props = {
    		$$slots: { default: [create_default_slot$1] },
    		$$scope: { ctx }
    	};

    	for (let i = 0; i < tabscroller_spread_levels.length; i += 1) {
    		tabscroller_props = assign(tabscroller_props, tabscroller_spread_levels[i]);
    	}

    	tabscroller = new TabScroller({ props: tabscroller_props });

    	let div_levels = [
    		{
    			class: div_class_value = "mdc-tab-bar " + /*className*/ ctx[1]
    		},
    		{ role: "tablist" },
    		exclude(/*$$props*/ ctx[7], [
    			"use",
    			"class",
    			"tabs",
    			"key",
    			"focusOnActivate",
    			"useAutomaticActivation",
    			"activeIndex",
    			"tabScroller$"
    		])
    	];

    	let div_data = {};

    	for (let i = 0; i < div_levels.length; i += 1) {
    		div_data = assign(div_data, div_levels[i]);
    	}

    	return {
    		c() {
    			div = element("div");
    			create_component(tabscroller.$$.fragment);
    			set_attributes(div, div_data);
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    			mount_component(tabscroller, div, null);
    			/*div_binding*/ ctx[15](div);
    			current = true;

    			if (!mounted) {
    				dispose = [
    					action_destroyer(useActions_action = useActions.call(null, div, /*use*/ ctx[0])),
    					action_destroyer(forwardEvents_action = /*forwardEvents*/ ctx[5].call(null, div)),
    					listen(div, "MDCTabBar:activated", /*activatedHandler*/ ctx[6])
    				];

    				mounted = true;
    			}
    		},
    		p(ctx, [dirty]) {
    			const tabscroller_changes = (dirty & /*prefixFilter, $$props*/ 128)
    			? get_spread_update(tabscroller_spread_levels, [get_spread_object(prefixFilter(/*$$props*/ ctx[7], "tabScroller$"))])
    			: {};

    			if (dirty & /*$$scope, tabs*/ 65540) {
    				tabscroller_changes.$$scope = { dirty, ctx };
    			}

    			tabscroller.$set(tabscroller_changes);

    			set_attributes(div, div_data = get_spread_update(div_levels, [
    				(!current || dirty & /*className*/ 2 && div_class_value !== (div_class_value = "mdc-tab-bar " + /*className*/ ctx[1])) && { class: div_class_value },
    				{ role: "tablist" },
    				dirty & /*$$props*/ 128 && exclude(/*$$props*/ ctx[7], [
    					"use",
    					"class",
    					"tabs",
    					"key",
    					"focusOnActivate",
    					"useAutomaticActivation",
    					"activeIndex",
    					"tabScroller$"
    				])
    			]));

    			if (useActions_action && is_function(useActions_action.update) && dirty & /*use*/ 1) useActions_action.update.call(null, /*use*/ ctx[0]);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(tabscroller.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(tabscroller.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    			destroy_component(tabscroller);
    			/*div_binding*/ ctx[15](null);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    function instance$5($$self, $$props, $$invalidate) {
    	const forwardEvents = forwardEventsBuilder(get_current_component(), ["MDCTabBar:activated"]);

    	let uninitializedValue = () => {
    		
    	};

    	let { use = [] } = $$props;
    	let { class: className = "" } = $$props;
    	let { tabs = [] } = $$props;
    	let { key = tab => tab } = $$props;
    	let { focusOnActivate = true } = $$props;
    	let { useAutomaticActivation = true } = $$props;
    	let { activeIndex = uninitializedValue } = $$props;
    	let { active = uninitializedValue } = $$props;

    	if (activeIndex === uninitializedValue && active === uninitializedValue) {
    		activeIndex = 0;
    		active = tabs[0];
    	} else if (activeIndex === uninitializedValue) {
    		activeIndex = tabs.indexOf(active);
    	} else if (active === uninitializedValue) {
    		active = tabs[activeIndex];
    	}

    	let element;
    	let tabBar;
    	let tabScrollerPromiseResolve;
    	let tabScrollerPromise = new Promise(resolve => tabScrollerPromiseResolve = resolve);
    	let tabPromiseResolve = [];
    	let tabPromise = tabs.map((tab, i) => new Promise(resolve => tabPromiseResolve[i] = resolve));
    	setContext("SMUI:tab-scroller:instantiate", false);
    	setContext("SMUI:tab-scroller:getInstance", getTabScrollerInstancePromise);
    	setContext("SMUI:tab:instantiate", false);
    	setContext("SMUI:tab:getInstance", getTabInstancePromise);
    	setContext("SMUI:tab:active", active);
    	let previousActiveIndex = activeIndex;
    	let previousActive = active;

    	onMount(() => {
    		$$invalidate(17, tabBar = new MDCTabBar(element));
    		tabScrollerPromiseResolve(tabBar.tabScroller_);

    		for (let i = 0; i < tabs.length; i++) {
    			tabPromiseResolve[i](tabBar.tabList_[i]);
    		}
    	});

    	onDestroy(() => {
    		tabBar && tabBar.destroy();
    	});

    	function getTabScrollerInstancePromise() {
    		return tabScrollerPromise;
    	}

    	function getTabInstancePromise(tabEntry) {
    		return tabPromise[tabs.indexOf(tabEntry)];
    	}

    	function updateIndexAfterActivate(index) {
    		$$invalidate(8, activeIndex = index);
    		$$invalidate(20, previousActiveIndex = index);
    		$$invalidate(9, active = tabs[index]);
    		$$invalidate(21, previousActive = tabs[index]);
    	}

    	function activatedHandler(e) {
    		updateIndexAfterActivate(e.detail.index);
    	}

    	function activateTab(index, ...args) {
    		updateIndexAfterActivate(index);
    		return tabBar.activateTab(index, ...args);
    	}

    	function scrollIntoView(...args) {
    		return tabBar.scrollIntoView(...args);
    	}

    	let { $$slots = {}, $$scope } = $$props;

    	function div_binding($$value) {
    		binding_callbacks[$$value ? "unshift" : "push"](() => {
    			element = $$value;
    			$$invalidate(4, element);
    		});
    	}

    	$$self.$$set = $$new_props => {
    		$$invalidate(7, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
    		if ("use" in $$new_props) $$invalidate(0, use = $$new_props.use);
    		if ("class" in $$new_props) $$invalidate(1, className = $$new_props.class);
    		if ("tabs" in $$new_props) $$invalidate(2, tabs = $$new_props.tabs);
    		if ("key" in $$new_props) $$invalidate(3, key = $$new_props.key);
    		if ("focusOnActivate" in $$new_props) $$invalidate(10, focusOnActivate = $$new_props.focusOnActivate);
    		if ("useAutomaticActivation" in $$new_props) $$invalidate(11, useAutomaticActivation = $$new_props.useAutomaticActivation);
    		if ("activeIndex" in $$new_props) $$invalidate(8, activeIndex = $$new_props.activeIndex);
    		if ("active" in $$new_props) $$invalidate(9, active = $$new_props.active);
    		if ("$$scope" in $$new_props) $$invalidate(16, $$scope = $$new_props.$$scope);
    	};

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*tabBar, focusOnActivate*/ 132096) {
    			 if (tabBar) {
    				$$invalidate(17, tabBar.focusOnActivate = focusOnActivate, tabBar);
    			}
    		}

    		if ($$self.$$.dirty & /*tabBar, useAutomaticActivation*/ 133120) {
    			 if (tabBar) {
    				$$invalidate(17, tabBar.useAutomaticActivation = useAutomaticActivation, tabBar);
    			}
    		}

    		if ($$self.$$.dirty & /*tabBar, tabs, activeIndex*/ 131332) {
    			 if (tabBar) {
    				$$invalidate(9, active = tabs[activeIndex]);
    			}
    		}

    		if ($$self.$$.dirty & /*tabBar, previousActiveIndex, activeIndex*/ 1179904) {
    			 if (tabBar && previousActiveIndex !== activeIndex) {
    				activateTab(activeIndex);
    			}
    		}

    		if ($$self.$$.dirty & /*tabBar, previousActive, active, tabs*/ 2228740) {
    			 if (tabBar && previousActive !== active) {
    				activateTab(tabs.indexOf(active));
    			}
    		}
    	};

    	$$props = exclude_internal_props($$props);

    	return [
    		use,
    		className,
    		tabs,
    		key,
    		element,
    		forwardEvents,
    		activatedHandler,
    		$$props,
    		activeIndex,
    		active,
    		focusOnActivate,
    		useAutomaticActivation,
    		activateTab,
    		scrollIntoView,
    		$$slots,
    		div_binding,
    		$$scope
    	];
    }

    class TabBar extends SvelteComponent {
    	constructor(options) {
    		super();

    		init(this, options, instance$5, create_fragment$5, safe_not_equal, {
    			use: 0,
    			class: 1,
    			tabs: 2,
    			key: 3,
    			focusOnActivate: 10,
    			useAutomaticActivation: 11,
    			activeIndex: 8,
    			active: 9,
    			activateTab: 12,
    			scrollIntoView: 13
    		});
    	}

    	get activateTab() {
    		return this.$$.ctx[12];
    	}

    	get scrollIntoView() {
    		return this.$$.ctx[13];
    	}
    }

    var css_248z$2 = "/**\n * @license\n * Copyright 2018 Google Inc.\n *\n * Permission is hereby granted, free of charge, to any person obtaining a copy\n * of this software and associated documentation files (the \"Software\"), to deal\n * in the Software without restriction, including without limitation the rights\n * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell\n * copies of the Software, and to permit persons to whom the Software is\n * furnished to do so, subject to the following conditions:\n *\n * The above copyright notice and this permission notice shall be included in\n * all copies or substantial portions of the Software.\n *\n * THE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\n * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\n * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\n * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\n * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\n * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN\n * THE SOFTWARE.\n */\n.mdc-tab-bar {\n  width: 100%;\n}\n\n/**\n * @license\n * Copyright 2018 Google Inc.\n *\n * Permission is hereby granted, free of charge, to any person obtaining a copy\n * of this software and associated documentation files (the \"Software\"), to deal\n * in the Software without restriction, including without limitation the rights\n * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell\n * copies of the Software, and to permit persons to whom the Software is\n * furnished to do so, subject to the following conditions:\n *\n * The above copyright notice and this permission notice shall be included in\n * all copies or substantial portions of the Software.\n *\n * THE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\n * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\n * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\n * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\n * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\n * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN\n * THE SOFTWARE.\n */\n.mdc-tab-scroller {\n  overflow-y: hidden;\n}\n\n.mdc-tab-scroller__test {\n  position: absolute;\n  top: -9999px;\n  width: 100px;\n  height: 100px;\n  overflow-x: scroll;\n}\n\n.mdc-tab-scroller__scroll-area {\n  -webkit-overflow-scrolling: touch;\n  display: flex;\n  overflow-x: hidden;\n}\n\n.mdc-tab-scroller__scroll-area::-webkit-scrollbar,\n.mdc-tab-scroller__test::-webkit-scrollbar {\n  display: none;\n}\n\n.mdc-tab-scroller__scroll-area--scroll {\n  overflow-x: scroll;\n}\n\n.mdc-tab-scroller__scroll-content {\n  position: relative;\n  display: flex;\n  flex: 1 0 auto;\n  transform: none;\n  will-change: transform;\n}\n\n.mdc-tab-scroller--align-start .mdc-tab-scroller__scroll-content {\n  justify-content: flex-start;\n}\n\n.mdc-tab-scroller--align-end .mdc-tab-scroller__scroll-content {\n  justify-content: flex-end;\n}\n\n.mdc-tab-scroller--align-center .mdc-tab-scroller__scroll-content {\n  justify-content: center;\n}\n\n.mdc-tab-scroller--animating .mdc-tab-scroller__scroll-area {\n  -webkit-overflow-scrolling: auto;\n}\n.mdc-tab-scroller--animating .mdc-tab-scroller__scroll-content {\n  transition: 250ms transform cubic-bezier(0.4, 0, 0.2, 1);\n}\n";
    styleInject(css_248z$2);

    /* node_modules\@smui\common\A.svelte generated by Svelte v3.24.1 */

    function create_fragment$6(ctx) {
    	let a;
    	let useActions_action;
    	let forwardEvents_action;
    	let current;
    	let mounted;
    	let dispose;
    	const default_slot_template = /*$$slots*/ ctx[5].default;
    	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[4], null);
    	let a_levels = [{ href: /*href*/ ctx[1] }, exclude(/*$$props*/ ctx[3], ["use", "href"])];
    	let a_data = {};

    	for (let i = 0; i < a_levels.length; i += 1) {
    		a_data = assign(a_data, a_levels[i]);
    	}

    	return {
    		c() {
    			a = element("a");
    			if (default_slot) default_slot.c();
    			set_attributes(a, a_data);
    		},
    		m(target, anchor) {
    			insert(target, a, anchor);

    			if (default_slot) {
    				default_slot.m(a, null);
    			}

    			current = true;

    			if (!mounted) {
    				dispose = [
    					action_destroyer(useActions_action = useActions.call(null, a, /*use*/ ctx[0])),
    					action_destroyer(forwardEvents_action = /*forwardEvents*/ ctx[2].call(null, a))
    				];

    				mounted = true;
    			}
    		},
    		p(ctx, [dirty]) {
    			if (default_slot) {
    				if (default_slot.p && dirty & /*$$scope*/ 16) {
    					update_slot(default_slot, default_slot_template, ctx, /*$$scope*/ ctx[4], dirty, null, null);
    				}
    			}

    			set_attributes(a, a_data = get_spread_update(a_levels, [
    				(!current || dirty & /*href*/ 2) && { href: /*href*/ ctx[1] },
    				dirty & /*$$props*/ 8 && exclude(/*$$props*/ ctx[3], ["use", "href"])
    			]));

    			if (useActions_action && is_function(useActions_action.update) && dirty & /*use*/ 1) useActions_action.update.call(null, /*use*/ ctx[0]);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(default_slot, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(default_slot, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(a);
    			if (default_slot) default_slot.d(detaching);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    function instance$6($$self, $$props, $$invalidate) {
    	const forwardEvents = forwardEventsBuilder(get_current_component());
    	let { use = [] } = $$props;
    	let { href = "javascript:void(0);" } = $$props;
    	let { $$slots = {}, $$scope } = $$props;

    	$$self.$$set = $$new_props => {
    		$$invalidate(3, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
    		if ("use" in $$new_props) $$invalidate(0, use = $$new_props.use);
    		if ("href" in $$new_props) $$invalidate(1, href = $$new_props.href);
    		if ("$$scope" in $$new_props) $$invalidate(4, $$scope = $$new_props.$$scope);
    	};

    	$$props = exclude_internal_props($$props);
    	return [use, href, forwardEvents, $$props, $$scope, $$slots];
    }

    class A extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$6, create_fragment$6, safe_not_equal, { use: 0, href: 1 });
    	}
    }

    /* node_modules\@smui\common\Button.svelte generated by Svelte v3.24.1 */

    function create_fragment$7(ctx) {
    	let button;
    	let useActions_action;
    	let forwardEvents_action;
    	let current;
    	let mounted;
    	let dispose;
    	const default_slot_template = /*$$slots*/ ctx[4].default;
    	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[3], null);
    	let button_levels = [exclude(/*$$props*/ ctx[2], ["use"])];
    	let button_data = {};

    	for (let i = 0; i < button_levels.length; i += 1) {
    		button_data = assign(button_data, button_levels[i]);
    	}

    	return {
    		c() {
    			button = element("button");
    			if (default_slot) default_slot.c();
    			set_attributes(button, button_data);
    		},
    		m(target, anchor) {
    			insert(target, button, anchor);

    			if (default_slot) {
    				default_slot.m(button, null);
    			}

    			current = true;

    			if (!mounted) {
    				dispose = [
    					action_destroyer(useActions_action = useActions.call(null, button, /*use*/ ctx[0])),
    					action_destroyer(forwardEvents_action = /*forwardEvents*/ ctx[1].call(null, button))
    				];

    				mounted = true;
    			}
    		},
    		p(ctx, [dirty]) {
    			if (default_slot) {
    				if (default_slot.p && dirty & /*$$scope*/ 8) {
    					update_slot(default_slot, default_slot_template, ctx, /*$$scope*/ ctx[3], dirty, null, null);
    				}
    			}

    			set_attributes(button, button_data = get_spread_update(button_levels, [dirty & /*$$props*/ 4 && exclude(/*$$props*/ ctx[2], ["use"])]));
    			if (useActions_action && is_function(useActions_action.update) && dirty & /*use*/ 1) useActions_action.update.call(null, /*use*/ ctx[0]);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(default_slot, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(default_slot, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(button);
    			if (default_slot) default_slot.d(detaching);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    function instance$7($$self, $$props, $$invalidate) {
    	const forwardEvents = forwardEventsBuilder(get_current_component());
    	let { use = [] } = $$props;
    	let { $$slots = {}, $$scope } = $$props;

    	$$self.$$set = $$new_props => {
    		$$invalidate(2, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
    		if ("use" in $$new_props) $$invalidate(0, use = $$new_props.use);
    		if ("$$scope" in $$new_props) $$invalidate(3, $$scope = $$new_props.$$scope);
    	};

    	$$props = exclude_internal_props($$props);
    	return [use, forwardEvents, $$props, $$scope, $$slots];
    }

    class Button extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$7, create_fragment$7, safe_not_equal, { use: 0 });
    	}
    }

    /* node_modules\@smui\button\Button.svelte generated by Svelte v3.24.1 */

    function create_default_slot$2(ctx) {
    	let current;
    	const default_slot_template = /*$$slots*/ ctx[17].default;
    	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[19], null);

    	return {
    		c() {
    			if (default_slot) default_slot.c();
    		},
    		m(target, anchor) {
    			if (default_slot) {
    				default_slot.m(target, anchor);
    			}

    			current = true;
    		},
    		p(ctx, dirty) {
    			if (default_slot) {
    				if (default_slot.p && dirty & /*$$scope*/ 524288) {
    					update_slot(default_slot, default_slot_template, ctx, /*$$scope*/ ctx[19], dirty, null, null);
    				}
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(default_slot, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(default_slot, local);
    			current = false;
    		},
    		d(detaching) {
    			if (default_slot) default_slot.d(detaching);
    		}
    	};
    }

    function create_fragment$8(ctx) {
    	let switch_instance;
    	let switch_instance_anchor;
    	let current;

    	const switch_instance_spread_levels = [
    		{
    			use: [
    				[
    					Ripple,
    					{
    						ripple: /*ripple*/ ctx[2],
    						unbounded: false,
    						classForward: /*func*/ ctx[18]
    					}
    				],
    				/*forwardEvents*/ ctx[11],
    				.../*use*/ ctx[0]
    			]
    		},
    		{
    			class: "\n    mdc-button\n    " + /*className*/ ctx[1] + "\n    " + /*rippleClasses*/ ctx[7].join(" ") + "\n    " + (/*variant*/ ctx[4] === "raised"
    			? "mdc-button--raised"
    			: "") + "\n    " + (/*variant*/ ctx[4] === "unelevated"
    			? "mdc-button--unelevated"
    			: "") + "\n    " + (/*variant*/ ctx[4] === "outlined"
    			? "mdc-button--outlined"
    			: "") + "\n    " + (/*dense*/ ctx[5] ? "mdc-button--dense" : "") + "\n    " + (/*color*/ ctx[3] === "secondary"
    			? "smui-button--color-secondary"
    			: "") + "\n    " + (/*context*/ ctx[12] === "card:action"
    			? "mdc-card__action"
    			: "") + "\n    " + (/*context*/ ctx[12] === "card:action"
    			? "mdc-card__action--button"
    			: "") + "\n    " + (/*context*/ ctx[12] === "dialog:action"
    			? "mdc-dialog__button"
    			: "") + "\n    " + (/*context*/ ctx[12] === "top-app-bar:navigation"
    			? "mdc-top-app-bar__navigation-icon"
    			: "") + "\n    " + (/*context*/ ctx[12] === "top-app-bar:action"
    			? "mdc-top-app-bar__action-item"
    			: "") + "\n    " + (/*context*/ ctx[12] === "snackbar"
    			? "mdc-snackbar__action"
    			: "") + "\n  "
    		},
    		/*actionProp*/ ctx[9],
    		/*defaultProp*/ ctx[10],
    		exclude(/*$$props*/ ctx[13], [
    			"use",
    			"class",
    			"ripple",
    			"color",
    			"variant",
    			"dense",
    			.../*dialogExcludes*/ ctx[8]
    		])
    	];

    	var switch_value = /*component*/ ctx[6];

    	function switch_props(ctx) {
    		let switch_instance_props = {
    			$$slots: { default: [create_default_slot$2] },
    			$$scope: { ctx }
    		};

    		for (let i = 0; i < switch_instance_spread_levels.length; i += 1) {
    			switch_instance_props = assign(switch_instance_props, switch_instance_spread_levels[i]);
    		}

    		return { props: switch_instance_props };
    	}

    	if (switch_value) {
    		switch_instance = new switch_value(switch_props(ctx));
    	}

    	return {
    		c() {
    			if (switch_instance) create_component(switch_instance.$$.fragment);
    			switch_instance_anchor = empty();
    		},
    		m(target, anchor) {
    			if (switch_instance) {
    				mount_component(switch_instance, target, anchor);
    			}

    			insert(target, switch_instance_anchor, anchor);
    			current = true;
    		},
    		p(ctx, [dirty]) {
    			const switch_instance_changes = (dirty & /*Ripple, ripple, rippleClasses, forwardEvents, use, className, variant, dense, color, context, actionProp, defaultProp, exclude, $$props, dialogExcludes*/ 16319)
    			? get_spread_update(switch_instance_spread_levels, [
    					dirty & /*Ripple, ripple, rippleClasses, forwardEvents, use*/ 2181 && {
    						use: [
    							[
    								Ripple,
    								{
    									ripple: /*ripple*/ ctx[2],
    									unbounded: false,
    									classForward: /*func*/ ctx[18]
    								}
    							],
    							/*forwardEvents*/ ctx[11],
    							.../*use*/ ctx[0]
    						]
    					},
    					dirty & /*className, rippleClasses, variant, dense, color, context*/ 4282 && {
    						class: "\n    mdc-button\n    " + /*className*/ ctx[1] + "\n    " + /*rippleClasses*/ ctx[7].join(" ") + "\n    " + (/*variant*/ ctx[4] === "raised"
    						? "mdc-button--raised"
    						: "") + "\n    " + (/*variant*/ ctx[4] === "unelevated"
    						? "mdc-button--unelevated"
    						: "") + "\n    " + (/*variant*/ ctx[4] === "outlined"
    						? "mdc-button--outlined"
    						: "") + "\n    " + (/*dense*/ ctx[5] ? "mdc-button--dense" : "") + "\n    " + (/*color*/ ctx[3] === "secondary"
    						? "smui-button--color-secondary"
    						: "") + "\n    " + (/*context*/ ctx[12] === "card:action"
    						? "mdc-card__action"
    						: "") + "\n    " + (/*context*/ ctx[12] === "card:action"
    						? "mdc-card__action--button"
    						: "") + "\n    " + (/*context*/ ctx[12] === "dialog:action"
    						? "mdc-dialog__button"
    						: "") + "\n    " + (/*context*/ ctx[12] === "top-app-bar:navigation"
    						? "mdc-top-app-bar__navigation-icon"
    						: "") + "\n    " + (/*context*/ ctx[12] === "top-app-bar:action"
    						? "mdc-top-app-bar__action-item"
    						: "") + "\n    " + (/*context*/ ctx[12] === "snackbar"
    						? "mdc-snackbar__action"
    						: "") + "\n  "
    					},
    					dirty & /*actionProp*/ 512 && get_spread_object(/*actionProp*/ ctx[9]),
    					dirty & /*defaultProp*/ 1024 && get_spread_object(/*defaultProp*/ ctx[10]),
    					dirty & /*exclude, $$props, dialogExcludes*/ 8448 && get_spread_object(exclude(/*$$props*/ ctx[13], [
    						"use",
    						"class",
    						"ripple",
    						"color",
    						"variant",
    						"dense",
    						.../*dialogExcludes*/ ctx[8]
    					]))
    				])
    			: {};

    			if (dirty & /*$$scope*/ 524288) {
    				switch_instance_changes.$$scope = { dirty, ctx };
    			}

    			if (switch_value !== (switch_value = /*component*/ ctx[6])) {
    				if (switch_instance) {
    					group_outros();
    					const old_component = switch_instance;

    					transition_out(old_component.$$.fragment, 1, 0, () => {
    						destroy_component(old_component, 1);
    					});

    					check_outros();
    				}

    				if (switch_value) {
    					switch_instance = new switch_value(switch_props(ctx));
    					create_component(switch_instance.$$.fragment);
    					transition_in(switch_instance.$$.fragment, 1);
    					mount_component(switch_instance, switch_instance_anchor.parentNode, switch_instance_anchor);
    				} else {
    					switch_instance = null;
    				}
    			} else if (switch_value) {
    				switch_instance.$set(switch_instance_changes);
    			}
    		},
    		i(local) {
    			if (current) return;
    			if (switch_instance) transition_in(switch_instance.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			if (switch_instance) transition_out(switch_instance.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(switch_instance_anchor);
    			if (switch_instance) destroy_component(switch_instance, detaching);
    		}
    	};
    }

    function instance$8($$self, $$props, $$invalidate) {
    	const forwardEvents = forwardEventsBuilder(get_current_component());
    	let { use = [] } = $$props;
    	let { class: className = "" } = $$props;
    	let { ripple = true } = $$props;
    	let { color = "primary" } = $$props;
    	let { variant = "text" } = $$props;
    	let { dense = false } = $$props;
    	let { href = null } = $$props;
    	let { action = "close" } = $$props;
    	let { default: defaultAction = false } = $$props;
    	let { component = href == null ? Button : A } = $$props;
    	let context = getContext("SMUI:button:context");
    	let rippleClasses = [];
    	setContext("SMUI:label:context", "button");
    	setContext("SMUI:icon:context", "button");
    	let { $$slots = {}, $$scope } = $$props;
    	const func = classes => $$invalidate(7, rippleClasses = classes);

    	$$self.$$set = $$new_props => {
    		$$invalidate(13, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
    		if ("use" in $$new_props) $$invalidate(0, use = $$new_props.use);
    		if ("class" in $$new_props) $$invalidate(1, className = $$new_props.class);
    		if ("ripple" in $$new_props) $$invalidate(2, ripple = $$new_props.ripple);
    		if ("color" in $$new_props) $$invalidate(3, color = $$new_props.color);
    		if ("variant" in $$new_props) $$invalidate(4, variant = $$new_props.variant);
    		if ("dense" in $$new_props) $$invalidate(5, dense = $$new_props.dense);
    		if ("href" in $$new_props) $$invalidate(14, href = $$new_props.href);
    		if ("action" in $$new_props) $$invalidate(15, action = $$new_props.action);
    		if ("default" in $$new_props) $$invalidate(16, defaultAction = $$new_props.default);
    		if ("component" in $$new_props) $$invalidate(6, component = $$new_props.component);
    		if ("$$scope" in $$new_props) $$invalidate(19, $$scope = $$new_props.$$scope);
    	};

    	let dialogExcludes;
    	let actionProp;
    	let defaultProp;

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*action*/ 32768) {
    			 $$invalidate(9, actionProp = context === "dialog:action" && action !== null
    			? { "data-mdc-dialog-action": action }
    			: {});
    		}

    		if ($$self.$$.dirty & /*defaultAction*/ 65536) {
    			 $$invalidate(10, defaultProp = context === "dialog:action" && defaultAction
    			? { "data-mdc-dialog-button-default": "" }
    			: {});
    		}
    	};

    	 $$invalidate(8, dialogExcludes = context === "dialog:action" ? ["action", "default"] : []);
    	$$props = exclude_internal_props($$props);

    	return [
    		use,
    		className,
    		ripple,
    		color,
    		variant,
    		dense,
    		component,
    		rippleClasses,
    		dialogExcludes,
    		actionProp,
    		defaultProp,
    		forwardEvents,
    		context,
    		$$props,
    		href,
    		action,
    		defaultAction,
    		$$slots,
    		func,
    		$$scope
    	];
    }

    class Button_1 extends SvelteComponent {
    	constructor(options) {
    		super();

    		init(this, options, instance$8, create_fragment$8, safe_not_equal, {
    			use: 0,
    			class: 1,
    			ripple: 2,
    			color: 3,
    			variant: 4,
    			dense: 5,
    			href: 14,
    			action: 15,
    			default: 16,
    			component: 6
    		});
    	}
    }

    var css_248z$3 = ".mdc-button {\n  font-family: Roboto, sans-serif;\n  -moz-osx-font-smoothing: grayscale;\n  -webkit-font-smoothing: antialiased;\n  font-size: 0.875rem;\n  line-height: 2.25rem;\n  font-weight: 500;\n  letter-spacing: 0.0892857143em;\n  text-decoration: none;\n  text-transform: uppercase;\n  padding: 0 8px 0 8px;\n  display: inline-flex;\n  position: relative;\n  align-items: center;\n  justify-content: center;\n  box-sizing: border-box;\n  min-width: 64px;\n  height: 36px;\n  border: none;\n  outline: none;\n  /* @alternate */\n  line-height: inherit;\n  user-select: none;\n  -webkit-appearance: none;\n  overflow: hidden;\n  vertical-align: middle;\n  border-radius: 4px;\n}\n.mdc-button::-moz-focus-inner {\n  padding: 0;\n  border: 0;\n}\n.mdc-button:active {\n  outline: none;\n}\n.mdc-button:hover {\n  cursor: pointer;\n}\n.mdc-button:disabled {\n  background-color: transparent;\n  color: rgba(0, 0, 0, 0.37);\n  cursor: default;\n  pointer-events: none;\n}\n.mdc-button.mdc-button--dense {\n  border-radius: 4px;\n}\n.mdc-button:not(:disabled) {\n  background-color: transparent;\n}\n.mdc-button .mdc-button__icon {\n  /* @noflip */\n  margin-left: 0;\n  /* @noflip */\n  margin-right: 8px;\n  display: inline-block;\n  width: 18px;\n  height: 18px;\n  font-size: 18px;\n  vertical-align: top;\n}\n[dir=rtl] .mdc-button .mdc-button__icon, .mdc-button .mdc-button__icon[dir=rtl] {\n  /* @noflip */\n  margin-left: 8px;\n  /* @noflip */\n  margin-right: 0;\n}\n.mdc-button:not(:disabled) {\n  color: #6200ee;\n  /* @alternate */\n  color: var(--mdc-theme-primary, #6200ee);\n}\n\n.mdc-button__label + .mdc-button__icon {\n  /* @noflip */\n  margin-left: 8px;\n  /* @noflip */\n  margin-right: 0;\n}\n[dir=rtl] .mdc-button__label + .mdc-button__icon, .mdc-button__label + .mdc-button__icon[dir=rtl] {\n  /* @noflip */\n  margin-left: 0;\n  /* @noflip */\n  margin-right: 8px;\n}\n\nsvg.mdc-button__icon {\n  fill: currentColor;\n}\n\n.mdc-button--raised .mdc-button__icon,\n.mdc-button--unelevated .mdc-button__icon,\n.mdc-button--outlined .mdc-button__icon {\n  /* @noflip */\n  margin-left: -4px;\n  /* @noflip */\n  margin-right: 8px;\n}\n[dir=rtl] .mdc-button--raised .mdc-button__icon, .mdc-button--raised .mdc-button__icon[dir=rtl],\n[dir=rtl] .mdc-button--unelevated .mdc-button__icon,\n.mdc-button--unelevated .mdc-button__icon[dir=rtl],\n[dir=rtl] .mdc-button--outlined .mdc-button__icon,\n.mdc-button--outlined .mdc-button__icon[dir=rtl] {\n  /* @noflip */\n  margin-left: 8px;\n  /* @noflip */\n  margin-right: -4px;\n}\n.mdc-button--raised .mdc-button__label + .mdc-button__icon,\n.mdc-button--unelevated .mdc-button__label + .mdc-button__icon,\n.mdc-button--outlined .mdc-button__label + .mdc-button__icon {\n  /* @noflip */\n  margin-left: 8px;\n  /* @noflip */\n  margin-right: -4px;\n}\n[dir=rtl] .mdc-button--raised .mdc-button__label + .mdc-button__icon, .mdc-button--raised .mdc-button__label + .mdc-button__icon[dir=rtl],\n[dir=rtl] .mdc-button--unelevated .mdc-button__label + .mdc-button__icon,\n.mdc-button--unelevated .mdc-button__label + .mdc-button__icon[dir=rtl],\n[dir=rtl] .mdc-button--outlined .mdc-button__label + .mdc-button__icon,\n.mdc-button--outlined .mdc-button__label + .mdc-button__icon[dir=rtl] {\n  /* @noflip */\n  margin-left: -4px;\n  /* @noflip */\n  margin-right: 8px;\n}\n\n.mdc-button--raised,\n.mdc-button--unelevated {\n  padding: 0 16px 0 16px;\n}\n.mdc-button--raised:disabled,\n.mdc-button--unelevated:disabled {\n  background-color: rgba(0, 0, 0, 0.12);\n  color: rgba(0, 0, 0, 0.37);\n}\n.mdc-button--raised:not(:disabled),\n.mdc-button--unelevated:not(:disabled) {\n  background-color: #6200ee;\n}\n@supports not (-ms-ime-align: auto) {\n  .mdc-button--raised:not(:disabled),\n.mdc-button--unelevated:not(:disabled) {\n    /* @alternate */\n    background-color: var(--mdc-theme-primary, #6200ee);\n  }\n}\n.mdc-button--raised:not(:disabled),\n.mdc-button--unelevated:not(:disabled) {\n  color: #fff;\n  /* @alternate */\n  color: var(--mdc-theme-on-primary, #fff);\n}\n\n.mdc-button--raised {\n  box-shadow: 0px 3px 1px -2px rgba(0, 0, 0, 0.2), 0px 2px 2px 0px rgba(0, 0, 0, 0.14), 0px 1px 5px 0px rgba(0, 0, 0, 0.12);\n  transition: box-shadow 280ms cubic-bezier(0.4, 0, 0.2, 1);\n}\n.mdc-button--raised:hover, .mdc-button--raised:focus {\n  box-shadow: 0px 2px 4px -1px rgba(0, 0, 0, 0.2), 0px 4px 5px 0px rgba(0, 0, 0, 0.14), 0px 1px 10px 0px rgba(0, 0, 0, 0.12);\n}\n.mdc-button--raised:active {\n  box-shadow: 0px 5px 5px -3px rgba(0, 0, 0, 0.2), 0px 8px 10px 1px rgba(0, 0, 0, 0.14), 0px 3px 14px 2px rgba(0, 0, 0, 0.12);\n}\n.mdc-button--raised:disabled {\n  box-shadow: 0px 0px 0px 0px rgba(0, 0, 0, 0.2), 0px 0px 0px 0px rgba(0, 0, 0, 0.14), 0px 0px 0px 0px rgba(0, 0, 0, 0.12);\n}\n\n.mdc-button--outlined {\n  border-style: solid;\n  padding: 0 15px 0 15px;\n  border-width: 1px;\n}\n.mdc-button--outlined:disabled {\n  border-color: rgba(0, 0, 0, 0.37);\n}\n.mdc-button--outlined:not(:disabled) {\n  border-color: #6200ee;\n  /* @alternate */\n  border-color: var(--mdc-theme-primary, #6200ee);\n}\n\n.mdc-button--dense {\n  height: 32px;\n  font-size: 0.8125rem;\n}\n\n@keyframes mdc-ripple-fg-radius-in {\n  from {\n    animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1);\n    transform: translate(var(--mdc-ripple-fg-translate-start, 0)) scale(1);\n  }\n  to {\n    transform: translate(var(--mdc-ripple-fg-translate-end, 0)) scale(var(--mdc-ripple-fg-scale, 1));\n  }\n}\n@keyframes mdc-ripple-fg-opacity-in {\n  from {\n    animation-timing-function: linear;\n    opacity: 0;\n  }\n  to {\n    opacity: var(--mdc-ripple-fg-opacity, 0);\n  }\n}\n@keyframes mdc-ripple-fg-opacity-out {\n  from {\n    animation-timing-function: linear;\n    opacity: var(--mdc-ripple-fg-opacity, 0);\n  }\n  to {\n    opacity: 0;\n  }\n}\n.mdc-ripple-surface--test-edge-var-bug {\n  --mdc-ripple-surface-test-edge-var: 1px solid #000;\n  visibility: hidden;\n}\n.mdc-ripple-surface--test-edge-var-bug::before {\n  border: var(--mdc-ripple-surface-test-edge-var);\n}\n\n.mdc-button {\n  --mdc-ripple-fg-size: 0;\n  --mdc-ripple-left: 0;\n  --mdc-ripple-top: 0;\n  --mdc-ripple-fg-scale: 1;\n  --mdc-ripple-fg-translate-end: 0;\n  --mdc-ripple-fg-translate-start: 0;\n  -webkit-tap-highlight-color: rgba(0, 0, 0, 0);\n}\n.mdc-button::before, .mdc-button::after {\n  position: absolute;\n  border-radius: 50%;\n  opacity: 0;\n  pointer-events: none;\n  content: \"\";\n}\n.mdc-button::before {\n  transition: opacity 15ms linear, background-color 15ms linear;\n  z-index: 1;\n}\n.mdc-button.mdc-ripple-upgraded::before {\n  transform: scale(var(--mdc-ripple-fg-scale, 1));\n}\n.mdc-button.mdc-ripple-upgraded::after {\n  top: 0;\n  /* @noflip */\n  left: 0;\n  transform: scale(0);\n  transform-origin: center center;\n}\n.mdc-button.mdc-ripple-upgraded--unbounded::after {\n  top: var(--mdc-ripple-top, 0);\n  /* @noflip */\n  left: var(--mdc-ripple-left, 0);\n}\n.mdc-button.mdc-ripple-upgraded--foreground-activation::after {\n  animation: mdc-ripple-fg-radius-in 225ms forwards, mdc-ripple-fg-opacity-in 75ms forwards;\n}\n.mdc-button.mdc-ripple-upgraded--foreground-deactivation::after {\n  animation: mdc-ripple-fg-opacity-out 150ms;\n  transform: translate(var(--mdc-ripple-fg-translate-end, 0)) scale(var(--mdc-ripple-fg-scale, 1));\n}\n.mdc-button::before, .mdc-button::after {\n  top: calc(50% - 100%);\n  /* @noflip */\n  left: calc(50% - 100%);\n  width: 200%;\n  height: 200%;\n}\n.mdc-button.mdc-ripple-upgraded::after {\n  width: var(--mdc-ripple-fg-size, 100%);\n  height: var(--mdc-ripple-fg-size, 100%);\n}\n.mdc-button::before, .mdc-button::after {\n  background-color: #6200ee;\n}\n@supports not (-ms-ime-align: auto) {\n  .mdc-button::before, .mdc-button::after {\n    /* @alternate */\n    background-color: var(--mdc-theme-primary, #6200ee);\n  }\n}\n.mdc-button:hover::before {\n  opacity: 0.04;\n}\n.mdc-button:not(.mdc-ripple-upgraded):focus::before, .mdc-button.mdc-ripple-upgraded--background-focused::before {\n  transition-duration: 75ms;\n  opacity: 0.12;\n}\n.mdc-button:not(.mdc-ripple-upgraded)::after {\n  transition: opacity 150ms linear;\n}\n.mdc-button:not(.mdc-ripple-upgraded):active::after {\n  transition-duration: 75ms;\n  opacity: 0.12;\n}\n.mdc-button.mdc-ripple-upgraded {\n  --mdc-ripple-fg-opacity: 0.12;\n}\n\n.mdc-button--raised::before, .mdc-button--raised::after,\n.mdc-button--unelevated::before,\n.mdc-button--unelevated::after {\n  background-color: #fff;\n}\n@supports not (-ms-ime-align: auto) {\n  .mdc-button--raised::before, .mdc-button--raised::after,\n.mdc-button--unelevated::before,\n.mdc-button--unelevated::after {\n    /* @alternate */\n    background-color: var(--mdc-theme-on-primary, #fff);\n  }\n}\n.mdc-button--raised:hover::before,\n.mdc-button--unelevated:hover::before {\n  opacity: 0.08;\n}\n.mdc-button--raised:not(.mdc-ripple-upgraded):focus::before, .mdc-button--raised.mdc-ripple-upgraded--background-focused::before,\n.mdc-button--unelevated:not(.mdc-ripple-upgraded):focus::before,\n.mdc-button--unelevated.mdc-ripple-upgraded--background-focused::before {\n  transition-duration: 75ms;\n  opacity: 0.24;\n}\n.mdc-button--raised:not(.mdc-ripple-upgraded)::after,\n.mdc-button--unelevated:not(.mdc-ripple-upgraded)::after {\n  transition: opacity 150ms linear;\n}\n.mdc-button--raised:not(.mdc-ripple-upgraded):active::after,\n.mdc-button--unelevated:not(.mdc-ripple-upgraded):active::after {\n  transition-duration: 75ms;\n  opacity: 0.24;\n}\n.mdc-button--raised.mdc-ripple-upgraded,\n.mdc-button--unelevated.mdc-ripple-upgraded {\n  --mdc-ripple-fg-opacity: 0.24;\n}\n\n.mdc-ripple-surface {\n  --mdc-ripple-fg-size: 0;\n  --mdc-ripple-left: 0;\n  --mdc-ripple-top: 0;\n  --mdc-ripple-fg-scale: 1;\n  --mdc-ripple-fg-translate-end: 0;\n  --mdc-ripple-fg-translate-start: 0;\n  -webkit-tap-highlight-color: rgba(0, 0, 0, 0);\n  position: relative;\n  outline: none;\n  overflow: hidden;\n}\n.mdc-ripple-surface::before, .mdc-ripple-surface::after {\n  position: absolute;\n  border-radius: 50%;\n  opacity: 0;\n  pointer-events: none;\n  content: \"\";\n}\n.mdc-ripple-surface::before {\n  transition: opacity 15ms linear, background-color 15ms linear;\n  z-index: 1;\n}\n.mdc-ripple-surface.mdc-ripple-upgraded::before {\n  transform: scale(var(--mdc-ripple-fg-scale, 1));\n}\n.mdc-ripple-surface.mdc-ripple-upgraded::after {\n  top: 0;\n  /* @noflip */\n  left: 0;\n  transform: scale(0);\n  transform-origin: center center;\n}\n.mdc-ripple-surface.mdc-ripple-upgraded--unbounded::after {\n  top: var(--mdc-ripple-top, 0);\n  /* @noflip */\n  left: var(--mdc-ripple-left, 0);\n}\n.mdc-ripple-surface.mdc-ripple-upgraded--foreground-activation::after {\n  animation: mdc-ripple-fg-radius-in 225ms forwards, mdc-ripple-fg-opacity-in 75ms forwards;\n}\n.mdc-ripple-surface.mdc-ripple-upgraded--foreground-deactivation::after {\n  animation: mdc-ripple-fg-opacity-out 150ms;\n  transform: translate(var(--mdc-ripple-fg-translate-end, 0)) scale(var(--mdc-ripple-fg-scale, 1));\n}\n.mdc-ripple-surface::before, .mdc-ripple-surface::after {\n  background-color: #000;\n}\n.mdc-ripple-surface:hover::before {\n  opacity: 0.04;\n}\n.mdc-ripple-surface:not(.mdc-ripple-upgraded):focus::before, .mdc-ripple-surface.mdc-ripple-upgraded--background-focused::before {\n  transition-duration: 75ms;\n  opacity: 0.12;\n}\n.mdc-ripple-surface:not(.mdc-ripple-upgraded)::after {\n  transition: opacity 150ms linear;\n}\n.mdc-ripple-surface:not(.mdc-ripple-upgraded):active::after {\n  transition-duration: 75ms;\n  opacity: 0.12;\n}\n.mdc-ripple-surface.mdc-ripple-upgraded {\n  --mdc-ripple-fg-opacity: 0.12;\n}\n.mdc-ripple-surface::before, .mdc-ripple-surface::after {\n  top: calc(50% - 100%);\n  /* @noflip */\n  left: calc(50% - 100%);\n  width: 200%;\n  height: 200%;\n}\n.mdc-ripple-surface.mdc-ripple-upgraded::after {\n  width: var(--mdc-ripple-fg-size, 100%);\n  height: var(--mdc-ripple-fg-size, 100%);\n}\n.mdc-ripple-surface[data-mdc-ripple-is-unbounded] {\n  overflow: visible;\n}\n.mdc-ripple-surface[data-mdc-ripple-is-unbounded]::before, .mdc-ripple-surface[data-mdc-ripple-is-unbounded]::after {\n  top: calc(50% - 50%);\n  /* @noflip */\n  left: calc(50% - 50%);\n  width: 100%;\n  height: 100%;\n}\n.mdc-ripple-surface[data-mdc-ripple-is-unbounded].mdc-ripple-upgraded::before, .mdc-ripple-surface[data-mdc-ripple-is-unbounded].mdc-ripple-upgraded::after {\n  top: var(--mdc-ripple-top, calc(50% - 50%));\n  /* @noflip */\n  left: var(--mdc-ripple-left, calc(50% - 50%));\n  width: var(--mdc-ripple-fg-size, 100%);\n  height: var(--mdc-ripple-fg-size, 100%);\n}\n.mdc-ripple-surface[data-mdc-ripple-is-unbounded].mdc-ripple-upgraded::after {\n  width: var(--mdc-ripple-fg-size, 100%);\n  height: var(--mdc-ripple-fg-size, 100%);\n}\n.mdc-ripple-surface--primary::before, .mdc-ripple-surface--primary::after {\n  background-color: #6200ee;\n}\n@supports not (-ms-ime-align: auto) {\n  .mdc-ripple-surface--primary::before, .mdc-ripple-surface--primary::after {\n    /* @alternate */\n    background-color: var(--mdc-theme-primary, #6200ee);\n  }\n}\n.mdc-ripple-surface--primary:hover::before {\n  opacity: 0.04;\n}\n.mdc-ripple-surface--primary:not(.mdc-ripple-upgraded):focus::before, .mdc-ripple-surface--primary.mdc-ripple-upgraded--background-focused::before {\n  transition-duration: 75ms;\n  opacity: 0.12;\n}\n.mdc-ripple-surface--primary:not(.mdc-ripple-upgraded)::after {\n  transition: opacity 150ms linear;\n}\n.mdc-ripple-surface--primary:not(.mdc-ripple-upgraded):active::after {\n  transition-duration: 75ms;\n  opacity: 0.12;\n}\n.mdc-ripple-surface--primary.mdc-ripple-upgraded {\n  --mdc-ripple-fg-opacity: 0.12;\n}\n.mdc-ripple-surface--accent::before, .mdc-ripple-surface--accent::after {\n  background-color: #018786;\n}\n@supports not (-ms-ime-align: auto) {\n  .mdc-ripple-surface--accent::before, .mdc-ripple-surface--accent::after {\n    /* @alternate */\n    background-color: var(--mdc-theme-secondary, #018786);\n  }\n}\n.mdc-ripple-surface--accent:hover::before {\n  opacity: 0.04;\n}\n.mdc-ripple-surface--accent:not(.mdc-ripple-upgraded):focus::before, .mdc-ripple-surface--accent.mdc-ripple-upgraded--background-focused::before {\n  transition-duration: 75ms;\n  opacity: 0.12;\n}\n.mdc-ripple-surface--accent:not(.mdc-ripple-upgraded)::after {\n  transition: opacity 150ms linear;\n}\n.mdc-ripple-surface--accent:not(.mdc-ripple-upgraded):active::after {\n  transition-duration: 75ms;\n  opacity: 0.12;\n}\n.mdc-ripple-surface--accent.mdc-ripple-upgraded {\n  --mdc-ripple-fg-opacity: 0.12;\n}\n\n.smui-button--color-secondary:not(:disabled) {\n  color: #018786;\n  /* @alternate */\n  color: var(--mdc-theme-secondary, #018786);\n}\n.smui-button--color-secondary.mdc-button--raised:not(:disabled), .smui-button--color-secondary.mdc-button--unelevated:not(:disabled) {\n  background-color: #018786;\n}\n@supports not (-ms-ime-align: auto) {\n  .smui-button--color-secondary.mdc-button--raised:not(:disabled), .smui-button--color-secondary.mdc-button--unelevated:not(:disabled) {\n    /* @alternate */\n    background-color: var(--mdc-theme-secondary, #018786);\n  }\n}\n.smui-button--color-secondary.mdc-button--raised:not(:disabled), .smui-button--color-secondary.mdc-button--unelevated:not(:disabled) {\n  color: #fff;\n  /* @alternate */\n  color: var(--mdc-theme-on-secondary, #fff);\n}\n.smui-button--color-secondary.mdc-button--outlined:not(:disabled) {\n  border-color: #018786;\n  /* @alternate */\n  border-color: var(--mdc-theme-secondary, #018786);\n}\n\n.smui-button--color-secondary::before, .smui-button--color-secondary::after {\n  background-color: #018786;\n}\n@supports not (-ms-ime-align: auto) {\n  .smui-button--color-secondary::before, .smui-button--color-secondary::after {\n    /* @alternate */\n    background-color: var(--mdc-theme-secondary, #018786);\n  }\n}\n.smui-button--color-secondary:hover::before {\n  opacity: 0.04;\n}\n.smui-button--color-secondary:not(.mdc-ripple-upgraded):focus::before, .smui-button--color-secondary.mdc-ripple-upgraded--background-focused::before {\n  transition-duration: 75ms;\n  opacity: 0.12;\n}\n.smui-button--color-secondary:not(.mdc-ripple-upgraded)::after {\n  transition: opacity 150ms linear;\n}\n.smui-button--color-secondary:not(.mdc-ripple-upgraded):active::after {\n  transition-duration: 75ms;\n  opacity: 0.12;\n}\n.smui-button--color-secondary.mdc-ripple-upgraded {\n  --mdc-ripple-fg-opacity: 0.12;\n}\n.smui-button--color-secondary.mdc-button--raised::before, .smui-button--color-secondary.mdc-button--raised::after, .smui-button--color-secondary.mdc-button--unelevated::before, .smui-button--color-secondary.mdc-button--unelevated::after {\n  background-color: #fff;\n}\n@supports not (-ms-ime-align: auto) {\n  .smui-button--color-secondary.mdc-button--raised::before, .smui-button--color-secondary.mdc-button--raised::after, .smui-button--color-secondary.mdc-button--unelevated::before, .smui-button--color-secondary.mdc-button--unelevated::after {\n    /* @alternate */\n    background-color: var(--mdc-theme-on-secondary, #fff);\n  }\n}\n.smui-button--color-secondary.mdc-button--raised:hover::before, .smui-button--color-secondary.mdc-button--unelevated:hover::before {\n  opacity: 0.08;\n}\n.smui-button--color-secondary.mdc-button--raised:not(.mdc-ripple-upgraded):focus::before, .smui-button--color-secondary.mdc-button--raised.mdc-ripple-upgraded--background-focused::before, .smui-button--color-secondary.mdc-button--unelevated:not(.mdc-ripple-upgraded):focus::before, .smui-button--color-secondary.mdc-button--unelevated.mdc-ripple-upgraded--background-focused::before {\n  transition-duration: 75ms;\n  opacity: 0.24;\n}\n.smui-button--color-secondary.mdc-button--raised:not(.mdc-ripple-upgraded)::after, .smui-button--color-secondary.mdc-button--unelevated:not(.mdc-ripple-upgraded)::after {\n  transition: opacity 150ms linear;\n}\n.smui-button--color-secondary.mdc-button--raised:not(.mdc-ripple-upgraded):active::after, .smui-button--color-secondary.mdc-button--unelevated:not(.mdc-ripple-upgraded):active::after {\n  transition-duration: 75ms;\n  opacity: 0.24;\n}\n.smui-button--color-secondary.mdc-button--raised.mdc-ripple-upgraded, .smui-button--color-secondary.mdc-button--unelevated.mdc-ripple-upgraded {\n  --mdc-ripple-fg-opacity: 0.24;\n}\n\n.smui-button__group {\n  display: inline-flex;\n}\n.smui-button__group > .mdc-button, .smui-button__group > .smui-button__group-item > .mdc-button {\n  margin-left: 0;\n  margin-right: 0;\n}\n.smui-button__group > .mdc-button:not(:last-child), .smui-button__group > .smui-button__group-item:not(:last-child) > .mdc-button {\n  border-top-right-radius: 0;\n  border-bottom-right-radius: 0;\n}\n.smui-button__group > .mdc-button:not(:first-child), .smui-button__group > .smui-button__group-item:not(:first-child) > .mdc-button {\n  border-top-left-radius: 0;\n  border-bottom-left-radius: 0;\n}\n.smui-button__group.smui-button__group--raised {\n  box-shadow: 0px 3px 1px -2px rgba(0, 0, 0, 0.2), 0px 2px 2px 0px rgba(0, 0, 0, 0.14), 0px 1px 5px 0px rgba(0, 0, 0, 0.12);\n}\n.smui-button__group > .mdc-button--raised, .smui-button__group > .smui-button__group-item > .mdc-button--raised {\n  border-radius: 4px;\n  box-shadow: 0px 0px 0px 0px rgba(0, 0, 0, 0.2), 0px 0px 0px 0px rgba(0, 0, 0, 0.14), 0px 0px 0px 0px rgba(0, 0, 0, 0.12);\n}\n.smui-button__group > .mdc-button--raised.mdc-button--dense, .smui-button__group > .smui-button__group-item > .mdc-button--raised.mdc-button--dense {\n  border-radius: 4px;\n}\n.smui-button__group > .mdc-button--raised:hover, .smui-button__group > .mdc-button--raised:focus, .smui-button__group > .smui-button__group-item > .mdc-button--raised:hover, .smui-button__group > .smui-button__group-item > .mdc-button--raised:focus {\n  box-shadow: 0px 0px 0px 0px rgba(0, 0, 0, 0.2), 0px 0px 0px 0px rgba(0, 0, 0, 0.14), 0px 0px 0px 0px rgba(0, 0, 0, 0.12);\n}\n.smui-button__group > .mdc-button--raised:active, .smui-button__group > .smui-button__group-item > .mdc-button--raised:active {\n  box-shadow: 0px 0px 0px 0px rgba(0, 0, 0, 0.2), 0px 0px 0px 0px rgba(0, 0, 0, 0.14), 0px 0px 0px 0px rgba(0, 0, 0, 0.12);\n}\n.smui-button__group > .mdc-button--raised:disabled, .smui-button__group > .smui-button__group-item > .mdc-button--raised:disabled {\n  box-shadow: 0px 0px 0px 0px rgba(0, 0, 0, 0.2), 0px 0px 0px 0px rgba(0, 0, 0, 0.14), 0px 0px 0px 0px rgba(0, 0, 0, 0.12);\n}\n.smui-button__group > .mdc-button--outlined:not(:last-child), .smui-button__group > .smui-button__group-item:not(:last-child) > .mdc-button--outlined {\n  border-right-width: 0;\n}\n";
    styleInject(css_248z$3);

    const subscriber_queue = [];
    /**
     * Create a `Writable` store that allows both updating and reading by subscription.
     * @param {*=}value initial value
     * @param {StartStopNotifier=}start start and stop notifications for subscriptions
     */
    function writable(value, start = noop) {
        let stop;
        const subscribers = [];
        function set(new_value) {
            if (safe_not_equal(value, new_value)) {
                value = new_value;
                if (stop) { // store is ready
                    const run_queue = !subscriber_queue.length;
                    for (let i = 0; i < subscribers.length; i += 1) {
                        const s = subscribers[i];
                        s[1]();
                        subscriber_queue.push(s, value);
                    }
                    if (run_queue) {
                        for (let i = 0; i < subscriber_queue.length; i += 2) {
                            subscriber_queue[i][0](subscriber_queue[i + 1]);
                        }
                        subscriber_queue.length = 0;
                    }
                }
            }
        }
        function update(fn) {
            set(fn(value));
        }
        function subscribe(run, invalidate = noop) {
            const subscriber = [run, invalidate];
            subscribers.push(subscriber);
            if (subscribers.length === 1) {
                stop = start(set) || noop;
            }
            run(value);
            return () => {
                const index = subscribers.indexOf(subscriber);
                if (index !== -1) {
                    subscribers.splice(index, 1);
                }
                if (subscribers.length === 0) {
                    stop();
                    stop = null;
                }
            };
        }
        return { set, update, subscribe };
    }

    const workDur = writable(25);
    const breakDur = writable(5);
    const longBreakDur = writable(15);
    const noOfSession = writable(4);

    /* src\assets\PauseCircleOutline.svelte generated by Svelte v3.24.1 */

    function create_fragment$9(ctx) {
    	let svg;
    	let path0;
    	let path1;

    	return {
    		c() {
    			svg = svg_element("svg");
    			path0 = svg_element("path");
    			path1 = svg_element("path");
    			attr(path0, "d", "M0 0h24v24H0z");
    			attr(path0, "fill", "none");
    			attr(path1, "d", "M9 16h2V8H9v8zm3-14C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48\r\n        10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59\r\n        8-8 8zm1-4h2V8h-2v8z");
    			attr(svg, "viewBox", "0 0 24 24");
    			attr(svg, "fill", "blue");
    			attr(svg, "width", "18px");
    			attr(svg, "height", "18px");
    		},
    		m(target, anchor) {
    			insert(target, svg, anchor);
    			append(svg, path0);
    			append(svg, path1);
    		},
    		p: noop,
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(svg);
    		}
    	};
    }

    class PauseCircleOutline extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, null, create_fragment$9, safe_not_equal, {});
    	}
    }

    /* src\assets\play_circle_outline.svelte generated by Svelte v3.24.1 */

    function create_fragment$a(ctx) {
    	let svg;
    	let path0;
    	let path1;

    	return {
    		c() {
    			svg = svg_element("svg");
    			path0 = svg_element("path");
    			path1 = svg_element("path");
    			attr(path0, "d", "M0 0h24v24H0z");
    			attr(path0, "fill", "none");
    			attr(path1, "d", "M10 16.5l6-4.5-6-4.5v9zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48\r\n        10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59\r\n        8-8 8z");
    			attr(svg, "viewBox", "0 0 24 24");
    			attr(svg, "fill", "blue");
    			attr(svg, "width", "18px");
    			attr(svg, "height", "18px");
    		},
    		m(target, anchor) {
    			insert(target, svg, anchor);
    			append(svg, path0);
    			append(svg, path1);
    		},
    		p: noop,
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(svg);
    		}
    	};
    }

    class Play_circle_outline extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, null, create_fragment$a, safe_not_equal, {});
    	}
    }

    /* src\assets\replay.svelte generated by Svelte v3.24.1 */

    function create_fragment$b(ctx) {
    	let svg;
    	let path0;
    	let path1;

    	return {
    		c() {
    			svg = svg_element("svg");
    			path0 = svg_element("path");
    			path1 = svg_element("path");
    			attr(path0, "d", "M0 0h24v24H0z");
    			attr(path0, "fill", "none");
    			attr(path1, "d", "M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42\r\n        3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z");
    			attr(svg, "viewBox", "0 0 24 24");
    			attr(svg, "fill", "blue");
    			attr(svg, "width", "18px");
    			attr(svg, "height", "18px");
    		},
    		m(target, anchor) {
    			insert(target, svg, anchor);
    			append(svg, path0);
    			append(svg, path1);
    		},
    		p: noop,
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(svg);
    		}
    	};
    }

    class Replay extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, null, create_fragment$b, safe_not_equal, {});
    	}
    }

    /* src\components\CountDown.svelte generated by Svelte v3.24.1 */

    function create_default_slot_5(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("Pause");
    		},
    		m(target, anchor) {
    			insert(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (82:4) <Button on:click={ctrPause}>
    function create_default_slot_4(ctx) {
    	let pausecircleoutline;
    	let t;
    	let label;
    	let current;
    	pausecircleoutline = new PauseCircleOutline({});

    	label = new Label({
    			props: {
    				$$slots: { default: [create_default_slot_5] },
    				$$scope: { ctx }
    			}
    		});

    	return {
    		c() {
    			create_component(pausecircleoutline.$$.fragment);
    			t = space();
    			create_component(label.$$.fragment);
    		},
    		m(target, anchor) {
    			mount_component(pausecircleoutline, target, anchor);
    			insert(target, t, anchor);
    			mount_component(label, target, anchor);
    			current = true;
    		},
    		p(ctx, dirty) {
    			const label_changes = {};

    			if (dirty & /*$$scope*/ 32768) {
    				label_changes.$$scope = { dirty, ctx };
    			}

    			label.$set(label_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(pausecircleoutline.$$.fragment, local);
    			transition_in(label.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(pausecircleoutline.$$.fragment, local);
    			transition_out(label.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(pausecircleoutline, detaching);
    			if (detaching) detach(t);
    			destroy_component(label, detaching);
    		}
    	};
    }

    // (88:8) <Label>
    function create_default_slot_3(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("Start");
    		},
    		m(target, anchor) {
    			insert(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (86:4) <Button on:click={nextCtr}>
    function create_default_slot_2(ctx) {
    	let playcircleoutline;
    	let t;
    	let label;
    	let current;
    	playcircleoutline = new Play_circle_outline({});

    	label = new Label({
    			props: {
    				$$slots: { default: [create_default_slot_3] },
    				$$scope: { ctx }
    			}
    		});

    	return {
    		c() {
    			create_component(playcircleoutline.$$.fragment);
    			t = space();
    			create_component(label.$$.fragment);
    		},
    		m(target, anchor) {
    			mount_component(playcircleoutline, target, anchor);
    			insert(target, t, anchor);
    			mount_component(label, target, anchor);
    			current = true;
    		},
    		p(ctx, dirty) {
    			const label_changes = {};

    			if (dirty & /*$$scope*/ 32768) {
    				label_changes.$$scope = { dirty, ctx };
    			}

    			label.$set(label_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(playcircleoutline.$$.fragment, local);
    			transition_in(label.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(playcircleoutline.$$.fragment, local);
    			transition_out(label.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(playcircleoutline, detaching);
    			if (detaching) detach(t);
    			destroy_component(label, detaching);
    		}
    	};
    }

    // (92:8) <Label>
    function create_default_slot_1$1(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("Reset");
    		},
    		m(target, anchor) {
    			insert(target, t, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (90:4) <Button on:click={ctrReset}>
    function create_default_slot$3(ctx) {
    	let replay;
    	let t;
    	let label;
    	let current;
    	replay = new Replay({});

    	label = new Label({
    			props: {
    				$$slots: { default: [create_default_slot_1$1] },
    				$$scope: { ctx }
    			}
    		});

    	return {
    		c() {
    			create_component(replay.$$.fragment);
    			t = space();
    			create_component(label.$$.fragment);
    		},
    		m(target, anchor) {
    			mount_component(replay, target, anchor);
    			insert(target, t, anchor);
    			mount_component(label, target, anchor);
    			current = true;
    		},
    		p(ctx, dirty) {
    			const label_changes = {};

    			if (dirty & /*$$scope*/ 32768) {
    				label_changes.$$scope = { dirty, ctx };
    			}

    			label.$set(label_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(replay.$$.fragment, local);
    			transition_in(label.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(replay.$$.fragment, local);
    			transition_out(label.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(replay, detaching);
    			if (detaching) detach(t);
    			destroy_component(label, detaching);
    		}
    	};
    }

    function create_fragment$c(ctx) {
    	let p;
    	let t0;
    	let t1;
    	let div;
    	let button0;
    	let t2;
    	let button1;
    	let t3;
    	let button2;
    	let current;

    	button0 = new Button_1({
    			props: {
    				$$slots: { default: [create_default_slot_4] },
    				$$scope: { ctx }
    			}
    		});

    	button0.$on("click", /*ctrPause*/ ctx[1]);

    	button1 = new Button_1({
    			props: {
    				$$slots: { default: [create_default_slot_2] },
    				$$scope: { ctx }
    			}
    		});

    	button1.$on("click", /*nextCtr*/ ctx[3]);

    	button2 = new Button_1({
    			props: {
    				$$slots: { default: [create_default_slot$3] },
    				$$scope: { ctx }
    			}
    		});

    	button2.$on("click", /*ctrReset*/ ctx[2]);

    	return {
    		c() {
    			p = element("p");
    			t0 = text(/*countDown*/ ctx[0]);
    			t1 = space();
    			div = element("div");
    			create_component(button0.$$.fragment);
    			t2 = space();
    			create_component(button1.$$.fragment);
    			t3 = space();
    			create_component(button2.$$.fragment);
    			attr(p, "class", "svelte-88cxro");
    			attr(div, "class", "btn-container svelte-88cxro");
    		},
    		m(target, anchor) {
    			insert(target, p, anchor);
    			append(p, t0);
    			insert(target, t1, anchor);
    			insert(target, div, anchor);
    			mount_component(button0, div, null);
    			append(div, t2);
    			mount_component(button1, div, null);
    			append(div, t3);
    			mount_component(button2, div, null);
    			current = true;
    		},
    		p(ctx, [dirty]) {
    			if (!current || dirty & /*countDown*/ 1) set_data(t0, /*countDown*/ ctx[0]);
    			const button0_changes = {};

    			if (dirty & /*$$scope*/ 32768) {
    				button0_changes.$$scope = { dirty, ctx };
    			}

    			button0.$set(button0_changes);
    			const button1_changes = {};

    			if (dirty & /*$$scope*/ 32768) {
    				button1_changes.$$scope = { dirty, ctx };
    			}

    			button1.$set(button1_changes);
    			const button2_changes = {};

    			if (dirty & /*$$scope*/ 32768) {
    				button2_changes.$$scope = { dirty, ctx };
    			}

    			button2.$set(button2_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(button0.$$.fragment, local);
    			transition_in(button1.$$.fragment, local);
    			transition_in(button2.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(button0.$$.fragment, local);
    			transition_out(button1.$$.fragment, local);
    			transition_out(button2.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(p);
    			if (detaching) detach(t1);
    			if (detaching) detach(div);
    			destroy_component(button0);
    			destroy_component(button1);
    			destroy_component(button2);
    		}
    	};
    }

    function instance$9($$self, $$props, $$invalidate) {
    	let $workDur;
    	let $noOfSession;
    	let $longBreakDur;
    	let $breakDur;
    	component_subscribe($$self, workDur, $$value => $$invalidate(9, $workDur = $$value));
    	component_subscribe($$self, noOfSession, $$value => $$invalidate(10, $noOfSession = $$value));
    	component_subscribe($$self, longBreakDur, $$value => $$invalidate(11, $longBreakDur = $$value));
    	component_subscribe($$self, breakDur, $$value => $$invalidate(12, $breakDur = $$value));
    	let min = $workDur;
    	let sec = 0;
    	let ctr = null;
    	let takingBreak = true;
    	let currentSession = $noOfSession;

    	let decCtr = () => {
    		if (min == 0 && sec == 0) {
    			nextCtr();
    		} else if (sec == 0) {
    			$$invalidate(4, min--, min);
    			$$invalidate(5, sec = 59);
    		} else {
    			$$invalidate(5, sec--, sec);
    		}
    	};

    	let ctrStart = () => {
    		if (ctr != null) return;
    		ctr = setInterval(decCtr, 1000);
    	};

    	let ctrPause = () => {
    		clearInterval(ctr);
    		ctr = null;
    	};

    	let ctrReset = () => {
    		ctrPause();
    		$$invalidate(4, min = $workDur);
    		$$invalidate(5, sec = 0);
    	};

    	let nextCtr = () => {
    		takingBreak = !takingBreak;

    		if (currentSession == 0) {
    			$$invalidate(4, min = $longBreakDur);
    			currentSession = $noOfSession;
    			alert("Long Break Starting");
    		} else if (takingBreak) {
    			$$invalidate(4, min = $breakDur);
    			alert("Break Starting");
    		} else {
    			currentSession--;
    			$$invalidate(4, min = $workDur);
    			alert("Session Starting");
    		}

    		console.log(takingBreak);
    		ctrStart();
    	};

    	onDestroy(ctrPause);
    	let countDown;

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*min, sec*/ 48) {
    			 $$invalidate(0, countDown = `${min < 10 ? "0" : ""}${min}:${sec < 10 ? "0" : ""}${sec}`);
    		}
    	};

    	return [countDown, ctrPause, ctrReset, nextCtr];
    }

    class CountDown extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$9, create_fragment$c, safe_not_equal, {});
    	}
    }

    /**
     * @license
     * Copyright 2017 Google Inc.
     *
     * Permission is hereby granted, free of charge, to any person obtaining a copy
     * of this software and associated documentation files (the "Software"), to deal
     * in the Software without restriction, including without limitation the rights
     * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
     * copies of the Software, and to permit persons to whom the Software is
     * furnished to do so, subject to the following conditions:
     *
     * The above copyright notice and this permission notice shall be included in
     * all copies or substantial portions of the Software.
     *
     * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
     * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
     * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
     * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
     * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
     * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
     * THE SOFTWARE.
     */
    var cssClasses$4 = {
        ACTIVE: 'mdc-slider--active',
        DISABLED: 'mdc-slider--disabled',
        DISCRETE: 'mdc-slider--discrete',
        FOCUS: 'mdc-slider--focus',
        HAS_TRACK_MARKER: 'mdc-slider--display-markers',
        IN_TRANSIT: 'mdc-slider--in-transit',
        IS_DISCRETE: 'mdc-slider--discrete',
    };
    var strings$6 = {
        ARIA_DISABLED: 'aria-disabled',
        ARIA_VALUEMAX: 'aria-valuemax',
        ARIA_VALUEMIN: 'aria-valuemin',
        ARIA_VALUENOW: 'aria-valuenow',
        CHANGE_EVENT: 'MDCSlider:change',
        INPUT_EVENT: 'MDCSlider:input',
        LAST_TRACK_MARKER_SELECTOR: '.mdc-slider__track-marker:last-child',
        PIN_VALUE_MARKER_SELECTOR: '.mdc-slider__pin-value-marker',
        STEP_DATA_ATTR: 'data-step',
        THUMB_CONTAINER_SELECTOR: '.mdc-slider__thumb-container',
        TRACK_MARKER_CONTAINER_SELECTOR: '.mdc-slider__track-marker-container',
        TRACK_SELECTOR: '.mdc-slider__track',
    };
    var numbers$2 = {
        PAGE_FACTOR: 4,
    };

    /**
     * @license
     * Copyright 2016 Google Inc.
     *
     * Permission is hereby granted, free of charge, to any person obtaining a copy
     * of this software and associated documentation files (the "Software"), to deal
     * in the Software without restriction, including without limitation the rights
     * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
     * copies of the Software, and to permit persons to whom the Software is
     * furnished to do so, subject to the following conditions:
     *
     * The above copyright notice and this permission notice shall be included in
     * all copies or substantial portions of the Software.
     *
     * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
     * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
     * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
     * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
     * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
     * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
     * THE SOFTWARE.
     */
    var cssPropertyNameMap = {
        animation: {
            prefixed: '-webkit-animation',
            standard: 'animation',
        },
        transform: {
            prefixed: '-webkit-transform',
            standard: 'transform',
        },
        transition: {
            prefixed: '-webkit-transition',
            standard: 'transition',
        },
    };
    var jsEventTypeMap = {
        animationend: {
            cssProperty: 'animation',
            prefixed: 'webkitAnimationEnd',
            standard: 'animationend',
        },
        animationiteration: {
            cssProperty: 'animation',
            prefixed: 'webkitAnimationIteration',
            standard: 'animationiteration',
        },
        animationstart: {
            cssProperty: 'animation',
            prefixed: 'webkitAnimationStart',
            standard: 'animationstart',
        },
        transitionend: {
            cssProperty: 'transition',
            prefixed: 'webkitTransitionEnd',
            standard: 'transitionend',
        },
    };
    function isWindow(windowObj) {
        return Boolean(windowObj.document) && typeof windowObj.document.createElement === 'function';
    }
    function getCorrectPropertyName(windowObj, cssProperty) {
        if (isWindow(windowObj) && cssProperty in cssPropertyNameMap) {
            var el = windowObj.document.createElement('div');
            var _a = cssPropertyNameMap[cssProperty], standard = _a.standard, prefixed = _a.prefixed;
            var isStandard = standard in el.style;
            return isStandard ? standard : prefixed;
        }
        return cssProperty;
    }
    function getCorrectEventName(windowObj, eventType) {
        if (isWindow(windowObj) && eventType in jsEventTypeMap) {
            var el = windowObj.document.createElement('div');
            var _a = jsEventTypeMap[eventType], standard = _a.standard, prefixed = _a.prefixed, cssProperty = _a.cssProperty;
            var isStandard = cssProperty in el.style;
            return isStandard ? standard : prefixed;
        }
        return eventType;
    }

    /**
     * @license
     * Copyright 2017 Google Inc.
     *
     * Permission is hereby granted, free of charge, to any person obtaining a copy
     * of this software and associated documentation files (the "Software"), to deal
     * in the Software without restriction, including without limitation the rights
     * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
     * copies of the Software, and to permit persons to whom the Software is
     * furnished to do so, subject to the following conditions:
     *
     * The above copyright notice and this permission notice shall be included in
     * all copies or substantial portions of the Software.
     *
     * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
     * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
     * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
     * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
     * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
     * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
     * THE SOFTWARE.
     */
    var DOWN_EVENTS = ['mousedown', 'pointerdown', 'touchstart'];
    var UP_EVENTS = ['mouseup', 'pointerup', 'touchend'];
    var MOVE_EVENT_MAP = {
        mousedown: 'mousemove',
        pointerdown: 'pointermove',
        touchstart: 'touchmove',
    };
    var KEY_IDS = {
        ARROW_DOWN: 'ArrowDown',
        ARROW_LEFT: 'ArrowLeft',
        ARROW_RIGHT: 'ArrowRight',
        ARROW_UP: 'ArrowUp',
        END: 'End',
        HOME: 'Home',
        PAGE_DOWN: 'PageDown',
        PAGE_UP: 'PageUp',
    };
    var MDCSliderFoundation = /** @class */ (function (_super) {
        __extends(MDCSliderFoundation, _super);
        function MDCSliderFoundation(adapter) {
            var _this = _super.call(this, __assign({}, MDCSliderFoundation.defaultAdapter, adapter)) || this;
            /**
             * We set this to NaN since we want it to be a number, but we can't use '0' or '-1'
             * because those could be valid tabindices set by the client code.
             */
            _this.savedTabIndex_ = NaN;
            _this.active_ = false;
            _this.inTransit_ = false;
            _this.isDiscrete_ = false;
            _this.hasTrackMarker_ = false;
            _this.handlingThumbTargetEvt_ = false;
            _this.min_ = 0;
            _this.max_ = 100;
            _this.step_ = 0;
            _this.value_ = 0;
            _this.disabled_ = false;
            _this.preventFocusState_ = false;
            _this.thumbContainerPointerHandler_ = function () { return _this.handlingThumbTargetEvt_ = true; };
            _this.interactionStartHandler_ = function (evt) { return _this.handleDown_(evt); };
            _this.keydownHandler_ = function (evt) { return _this.handleKeydown_(evt); };
            _this.focusHandler_ = function () { return _this.handleFocus_(); };
            _this.blurHandler_ = function () { return _this.handleBlur_(); };
            _this.resizeHandler_ = function () { return _this.layout(); };
            return _this;
        }
        Object.defineProperty(MDCSliderFoundation, "cssClasses", {
            get: function () {
                return cssClasses$4;
            },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(MDCSliderFoundation, "strings", {
            get: function () {
                return strings$6;
            },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(MDCSliderFoundation, "numbers", {
            get: function () {
                return numbers$2;
            },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(MDCSliderFoundation, "defaultAdapter", {
            get: function () {
                // tslint:disable:object-literal-sort-keys Methods should be in the same order as the adapter interface.
                return {
                    hasClass: function () { return false; },
                    addClass: function () { return undefined; },
                    removeClass: function () { return undefined; },
                    getAttribute: function () { return null; },
                    setAttribute: function () { return undefined; },
                    removeAttribute: function () { return undefined; },
                    computeBoundingRect: function () { return ({ top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0 }); },
                    getTabIndex: function () { return 0; },
                    registerInteractionHandler: function () { return undefined; },
                    deregisterInteractionHandler: function () { return undefined; },
                    registerThumbContainerInteractionHandler: function () { return undefined; },
                    deregisterThumbContainerInteractionHandler: function () { return undefined; },
                    registerBodyInteractionHandler: function () { return undefined; },
                    deregisterBodyInteractionHandler: function () { return undefined; },
                    registerResizeHandler: function () { return undefined; },
                    deregisterResizeHandler: function () { return undefined; },
                    notifyInput: function () { return undefined; },
                    notifyChange: function () { return undefined; },
                    setThumbContainerStyleProperty: function () { return undefined; },
                    setTrackStyleProperty: function () { return undefined; },
                    setMarkerValue: function () { return undefined; },
                    appendTrackMarkers: function () { return undefined; },
                    removeTrackMarkers: function () { return undefined; },
                    setLastTrackMarkersStyleProperty: function () { return undefined; },
                    isRTL: function () { return false; },
                };
                // tslint:enable:object-literal-sort-keys
            },
            enumerable: true,
            configurable: true
        });
        MDCSliderFoundation.prototype.init = function () {
            var _this = this;
            this.isDiscrete_ = this.adapter_.hasClass(cssClasses$4.IS_DISCRETE);
            this.hasTrackMarker_ = this.adapter_.hasClass(cssClasses$4.HAS_TRACK_MARKER);
            DOWN_EVENTS.forEach(function (evtName) {
                _this.adapter_.registerInteractionHandler(evtName, _this.interactionStartHandler_);
                _this.adapter_.registerThumbContainerInteractionHandler(evtName, _this.thumbContainerPointerHandler_);
            });
            this.adapter_.registerInteractionHandler('keydown', this.keydownHandler_);
            this.adapter_.registerInteractionHandler('focus', this.focusHandler_);
            this.adapter_.registerInteractionHandler('blur', this.blurHandler_);
            this.adapter_.registerResizeHandler(this.resizeHandler_);
            this.layout();
            // At last step, provide a reasonable default value to discrete slider
            if (this.isDiscrete_ && this.getStep() === 0) {
                this.step_ = 1;
            }
        };
        MDCSliderFoundation.prototype.destroy = function () {
            var _this = this;
            DOWN_EVENTS.forEach(function (evtName) {
                _this.adapter_.deregisterInteractionHandler(evtName, _this.interactionStartHandler_);
                _this.adapter_.deregisterThumbContainerInteractionHandler(evtName, _this.thumbContainerPointerHandler_);
            });
            this.adapter_.deregisterInteractionHandler('keydown', this.keydownHandler_);
            this.adapter_.deregisterInteractionHandler('focus', this.focusHandler_);
            this.adapter_.deregisterInteractionHandler('blur', this.blurHandler_);
            this.adapter_.deregisterResizeHandler(this.resizeHandler_);
        };
        MDCSliderFoundation.prototype.setupTrackMarker = function () {
            if (this.isDiscrete_ && this.hasTrackMarker_ && this.getStep() !== 0) {
                var min = this.getMin();
                var max = this.getMax();
                var step = this.getStep();
                var numMarkers = (max - min) / step;
                // In case distance between max & min is indivisible to step,
                // we place the secondary to last marker proportionally at where thumb
                // could reach and place the last marker at max value
                var indivisible = Math.ceil(numMarkers) !== numMarkers;
                if (indivisible) {
                    numMarkers = Math.ceil(numMarkers);
                }
                this.adapter_.removeTrackMarkers();
                this.adapter_.appendTrackMarkers(numMarkers);
                if (indivisible) {
                    var lastStepRatio = (max - numMarkers * step) / step + 1;
                    this.adapter_.setLastTrackMarkersStyleProperty('flex-grow', String(lastStepRatio));
                }
            }
        };
        MDCSliderFoundation.prototype.layout = function () {
            this.rect_ = this.adapter_.computeBoundingRect();
            this.updateUIForCurrentValue_();
        };
        MDCSliderFoundation.prototype.getValue = function () {
            return this.value_;
        };
        MDCSliderFoundation.prototype.setValue = function (value) {
            this.setValue_(value, false);
        };
        MDCSliderFoundation.prototype.getMax = function () {
            return this.max_;
        };
        MDCSliderFoundation.prototype.setMax = function (max) {
            if (max < this.min_) {
                throw new Error('Cannot set max to be less than the slider\'s minimum value');
            }
            this.max_ = max;
            this.setValue_(this.value_, false, true);
            this.adapter_.setAttribute(strings$6.ARIA_VALUEMAX, String(this.max_));
            this.setupTrackMarker();
        };
        MDCSliderFoundation.prototype.getMin = function () {
            return this.min_;
        };
        MDCSliderFoundation.prototype.setMin = function (min) {
            if (min > this.max_) {
                throw new Error('Cannot set min to be greater than the slider\'s maximum value');
            }
            this.min_ = min;
            this.setValue_(this.value_, false, true);
            this.adapter_.setAttribute(strings$6.ARIA_VALUEMIN, String(this.min_));
            this.setupTrackMarker();
        };
        MDCSliderFoundation.prototype.getStep = function () {
            return this.step_;
        };
        MDCSliderFoundation.prototype.setStep = function (step) {
            if (step < 0) {
                throw new Error('Step cannot be set to a negative number');
            }
            if (this.isDiscrete_ && (typeof (step) !== 'number' || step < 1)) {
                step = 1;
            }
            this.step_ = step;
            this.setValue_(this.value_, false, true);
            this.setupTrackMarker();
        };
        MDCSliderFoundation.prototype.isDisabled = function () {
            return this.disabled_;
        };
        MDCSliderFoundation.prototype.setDisabled = function (disabled) {
            this.disabled_ = disabled;
            this.toggleClass_(cssClasses$4.DISABLED, this.disabled_);
            if (this.disabled_) {
                this.savedTabIndex_ = this.adapter_.getTabIndex();
                this.adapter_.setAttribute(strings$6.ARIA_DISABLED, 'true');
                this.adapter_.removeAttribute('tabindex');
            }
            else {
                this.adapter_.removeAttribute(strings$6.ARIA_DISABLED);
                if (!isNaN(this.savedTabIndex_)) {
                    this.adapter_.setAttribute('tabindex', String(this.savedTabIndex_));
                }
            }
        };
        /**
         * Called when the user starts interacting with the slider
         */
        MDCSliderFoundation.prototype.handleDown_ = function (downEvent) {
            var _this = this;
            if (this.disabled_) {
                return;
            }
            this.preventFocusState_ = true;
            this.setInTransit_(!this.handlingThumbTargetEvt_);
            this.handlingThumbTargetEvt_ = false;
            this.setActive_(true);
            var moveHandler = function (moveEvent) {
                _this.handleMove_(moveEvent);
            };
            var moveEventType = MOVE_EVENT_MAP[downEvent.type];
            // Note: upHandler is [de]registered on ALL potential pointer-related release event types, since some browsers
            // do not always fire these consistently in pairs.
            // (See https://github.com/material-components/material-components-web/issues/1192)
            var upHandler = function () {
                _this.handleUp_();
                _this.adapter_.deregisterBodyInteractionHandler(moveEventType, moveHandler);
                UP_EVENTS.forEach(function (evtName) { return _this.adapter_.deregisterBodyInteractionHandler(evtName, upHandler); });
            };
            this.adapter_.registerBodyInteractionHandler(moveEventType, moveHandler);
            UP_EVENTS.forEach(function (evtName) { return _this.adapter_.registerBodyInteractionHandler(evtName, upHandler); });
            this.setValueFromEvt_(downEvent);
        };
        /**
         * Called when the user moves the slider
         */
        MDCSliderFoundation.prototype.handleMove_ = function (evt) {
            evt.preventDefault();
            this.setValueFromEvt_(evt);
        };
        /**
         * Called when the user's interaction with the slider ends
         */
        MDCSliderFoundation.prototype.handleUp_ = function () {
            this.setActive_(false);
            this.adapter_.notifyChange();
        };
        /**
         * Returns the pageX of the event
         */
        MDCSliderFoundation.prototype.getPageX_ = function (evt) {
            if (evt.targetTouches && evt.targetTouches.length > 0) {
                return evt.targetTouches[0].pageX;
            }
            return evt.pageX;
        };
        /**
         * Sets the slider value from an event
         */
        MDCSliderFoundation.prototype.setValueFromEvt_ = function (evt) {
            var pageX = this.getPageX_(evt);
            var value = this.computeValueFromPageX_(pageX);
            this.setValue_(value, true);
        };
        /**
         * Computes the new value from the pageX position
         */
        MDCSliderFoundation.prototype.computeValueFromPageX_ = function (pageX) {
            var _a = this, max = _a.max_, min = _a.min_;
            var xPos = pageX - this.rect_.left;
            var pctComplete = xPos / this.rect_.width;
            if (this.adapter_.isRTL()) {
                pctComplete = 1 - pctComplete;
            }
            // Fit the percentage complete between the range [min,max]
            // by remapping from [0, 1] to [min, min+(max-min)].
            return min + pctComplete * (max - min);
        };
        /**
         * Handles keydown events
         */
        MDCSliderFoundation.prototype.handleKeydown_ = function (evt) {
            var keyId = this.getKeyId_(evt);
            var value = this.getValueForKeyId_(keyId);
            if (isNaN(value)) {
                return;
            }
            // Prevent page from scrolling due to key presses that would normally scroll the page
            evt.preventDefault();
            this.adapter_.addClass(cssClasses$4.FOCUS);
            this.setValue_(value, true);
            this.adapter_.notifyChange();
        };
        /**
         * Returns the computed name of the event
         */
        MDCSliderFoundation.prototype.getKeyId_ = function (kbdEvt) {
            if (kbdEvt.key === KEY_IDS.ARROW_LEFT || kbdEvt.keyCode === 37) {
                return KEY_IDS.ARROW_LEFT;
            }
            if (kbdEvt.key === KEY_IDS.ARROW_RIGHT || kbdEvt.keyCode === 39) {
                return KEY_IDS.ARROW_RIGHT;
            }
            if (kbdEvt.key === KEY_IDS.ARROW_UP || kbdEvt.keyCode === 38) {
                return KEY_IDS.ARROW_UP;
            }
            if (kbdEvt.key === KEY_IDS.ARROW_DOWN || kbdEvt.keyCode === 40) {
                return KEY_IDS.ARROW_DOWN;
            }
            if (kbdEvt.key === KEY_IDS.HOME || kbdEvt.keyCode === 36) {
                return KEY_IDS.HOME;
            }
            if (kbdEvt.key === KEY_IDS.END || kbdEvt.keyCode === 35) {
                return KEY_IDS.END;
            }
            if (kbdEvt.key === KEY_IDS.PAGE_UP || kbdEvt.keyCode === 33) {
                return KEY_IDS.PAGE_UP;
            }
            if (kbdEvt.key === KEY_IDS.PAGE_DOWN || kbdEvt.keyCode === 34) {
                return KEY_IDS.PAGE_DOWN;
            }
            return '';
        };
        /**
         * Computes the value given a keyboard key ID
         */
        MDCSliderFoundation.prototype.getValueForKeyId_ = function (keyId) {
            var _a = this, max = _a.max_, min = _a.min_, step = _a.step_;
            var delta = step || (max - min) / 100;
            var valueNeedsToBeFlipped = this.adapter_.isRTL() && (keyId === KEY_IDS.ARROW_LEFT || keyId === KEY_IDS.ARROW_RIGHT);
            if (valueNeedsToBeFlipped) {
                delta = -delta;
            }
            switch (keyId) {
                case KEY_IDS.ARROW_LEFT:
                case KEY_IDS.ARROW_DOWN:
                    return this.value_ - delta;
                case KEY_IDS.ARROW_RIGHT:
                case KEY_IDS.ARROW_UP:
                    return this.value_ + delta;
                case KEY_IDS.HOME:
                    return this.min_;
                case KEY_IDS.END:
                    return this.max_;
                case KEY_IDS.PAGE_UP:
                    return this.value_ + delta * numbers$2.PAGE_FACTOR;
                case KEY_IDS.PAGE_DOWN:
                    return this.value_ - delta * numbers$2.PAGE_FACTOR;
                default:
                    return NaN;
            }
        };
        MDCSliderFoundation.prototype.handleFocus_ = function () {
            if (this.preventFocusState_) {
                return;
            }
            this.adapter_.addClass(cssClasses$4.FOCUS);
        };
        MDCSliderFoundation.prototype.handleBlur_ = function () {
            this.preventFocusState_ = false;
            this.adapter_.removeClass(cssClasses$4.FOCUS);
        };
        /**
         * Sets the value of the slider
         */
        MDCSliderFoundation.prototype.setValue_ = function (value, shouldFireInput, force) {
            if (force === void 0) { force = false; }
            if (value === this.value_ && !force) {
                return;
            }
            var _a = this, min = _a.min_, max = _a.max_;
            var valueSetToBoundary = value === min || value === max;
            if (this.step_ && !valueSetToBoundary) {
                value = this.quantize_(value);
            }
            if (value < min) {
                value = min;
            }
            else if (value > max) {
                value = max;
            }
            this.value_ = value;
            this.adapter_.setAttribute(strings$6.ARIA_VALUENOW, String(this.value_));
            this.updateUIForCurrentValue_();
            if (shouldFireInput) {
                this.adapter_.notifyInput();
                if (this.isDiscrete_) {
                    this.adapter_.setMarkerValue(value);
                }
            }
        };
        /**
         * Calculates the quantized value
         */
        MDCSliderFoundation.prototype.quantize_ = function (value) {
            var numSteps = Math.round(value / this.step_);
            return numSteps * this.step_;
        };
        MDCSliderFoundation.prototype.updateUIForCurrentValue_ = function () {
            var _this = this;
            var _a = this, max = _a.max_, min = _a.min_, value = _a.value_;
            var pctComplete = (value - min) / (max - min);
            var translatePx = pctComplete * this.rect_.width;
            if (this.adapter_.isRTL()) {
                translatePx = this.rect_.width - translatePx;
            }
            var transformProp = getCorrectPropertyName(window, 'transform');
            var transitionendEvtName = getCorrectEventName(window, 'transitionend');
            if (this.inTransit_) {
                var onTransitionEnd_1 = function () {
                    _this.setInTransit_(false);
                    _this.adapter_.deregisterThumbContainerInteractionHandler(transitionendEvtName, onTransitionEnd_1);
                };
                this.adapter_.registerThumbContainerInteractionHandler(transitionendEvtName, onTransitionEnd_1);
            }
            requestAnimationFrame(function () {
                // NOTE(traviskaufman): It would be nice to use calc() here,
                // but IE cannot handle calcs in transforms correctly.
                // See: https://goo.gl/NC2itk
                // Also note that the -50% offset is used to center the slider thumb.
                _this.adapter_.setThumbContainerStyleProperty(transformProp, "translateX(" + translatePx + "px) translateX(-50%)");
                _this.adapter_.setTrackStyleProperty(transformProp, "scaleX(" + pctComplete + ")");
            });
        };
        /**
         * Toggles the active state of the slider
         */
        MDCSliderFoundation.prototype.setActive_ = function (active) {
            this.active_ = active;
            this.toggleClass_(cssClasses$4.ACTIVE, this.active_);
        };
        /**
         * Toggles the inTransit state of the slider
         */
        MDCSliderFoundation.prototype.setInTransit_ = function (inTransit) {
            this.inTransit_ = inTransit;
            this.toggleClass_(cssClasses$4.IN_TRANSIT, this.inTransit_);
        };
        /**
         * Conditionally adds or removes a class based on shouldBePresent
         */
        MDCSliderFoundation.prototype.toggleClass_ = function (className, shouldBePresent) {
            if (shouldBePresent) {
                this.adapter_.addClass(className);
            }
            else {
                this.adapter_.removeClass(className);
            }
        };
        return MDCSliderFoundation;
    }(MDCFoundation));

    /**
     * @license
     * Copyright 2017 Google Inc.
     *
     * Permission is hereby granted, free of charge, to any person obtaining a copy
     * of this software and associated documentation files (the "Software"), to deal
     * in the Software without restriction, including without limitation the rights
     * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
     * copies of the Software, and to permit persons to whom the Software is
     * furnished to do so, subject to the following conditions:
     *
     * The above copyright notice and this permission notice shall be included in
     * all copies or substantial portions of the Software.
     *
     * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
     * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
     * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
     * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
     * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
     * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
     * THE SOFTWARE.
     */
    var MDCSlider = /** @class */ (function (_super) {
        __extends(MDCSlider, _super);
        function MDCSlider() {
            return _super !== null && _super.apply(this, arguments) || this;
        }
        MDCSlider.attachTo = function (root) {
            return new MDCSlider(root);
        };
        Object.defineProperty(MDCSlider.prototype, "value", {
            get: function () {
                return this.foundation_.getValue();
            },
            set: function (value) {
                this.foundation_.setValue(value);
            },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(MDCSlider.prototype, "min", {
            get: function () {
                return this.foundation_.getMin();
            },
            set: function (min) {
                this.foundation_.setMin(min);
            },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(MDCSlider.prototype, "max", {
            get: function () {
                return this.foundation_.getMax();
            },
            set: function (max) {
                this.foundation_.setMax(max);
            },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(MDCSlider.prototype, "step", {
            get: function () {
                return this.foundation_.getStep();
            },
            set: function (step) {
                this.foundation_.setStep(step);
            },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(MDCSlider.prototype, "disabled", {
            get: function () {
                return this.foundation_.isDisabled();
            },
            set: function (disabled) {
                this.foundation_.setDisabled(disabled);
            },
            enumerable: true,
            configurable: true
        });
        MDCSlider.prototype.initialize = function () {
            this.thumbContainer_ = this.root_.querySelector(strings$6.THUMB_CONTAINER_SELECTOR);
            this.track_ = this.root_.querySelector(strings$6.TRACK_SELECTOR);
            this.pinValueMarker_ = this.root_.querySelector(strings$6.PIN_VALUE_MARKER_SELECTOR);
            this.trackMarkerContainer_ = this.root_.querySelector(strings$6.TRACK_MARKER_CONTAINER_SELECTOR);
        };
        MDCSlider.prototype.getDefaultFoundation = function () {
            var _this = this;
            // DO NOT INLINE this variable. For backward compatibility, foundations take a Partial<MDCFooAdapter>.
            // To ensure we don't accidentally omit any methods, we need a separate, strongly typed adapter variable.
            // tslint:disable:object-literal-sort-keys Methods should be in the same order as the adapter interface.
            var adapter = {
                hasClass: function (className) { return _this.root_.classList.contains(className); },
                addClass: function (className) { return _this.root_.classList.add(className); },
                removeClass: function (className) { return _this.root_.classList.remove(className); },
                getAttribute: function (name) { return _this.root_.getAttribute(name); },
                setAttribute: function (name, value) { return _this.root_.setAttribute(name, value); },
                removeAttribute: function (name) { return _this.root_.removeAttribute(name); },
                computeBoundingRect: function () { return _this.root_.getBoundingClientRect(); },
                getTabIndex: function () { return _this.root_.tabIndex; },
                registerInteractionHandler: function (evtType, handler) { return _this.listen(evtType, handler, applyPassive()); },
                deregisterInteractionHandler: function (evtType, handler) { return _this.unlisten(evtType, handler, applyPassive()); },
                registerThumbContainerInteractionHandler: function (evtType, handler) {
                    _this.thumbContainer_.addEventListener(evtType, handler, applyPassive());
                },
                deregisterThumbContainerInteractionHandler: function (evtType, handler) {
                    _this.thumbContainer_.removeEventListener(evtType, handler, applyPassive());
                },
                registerBodyInteractionHandler: function (evtType, handler) { return document.body.addEventListener(evtType, handler); },
                deregisterBodyInteractionHandler: function (evtType, handler) { return document.body.removeEventListener(evtType, handler); },
                registerResizeHandler: function (handler) { return window.addEventListener('resize', handler); },
                deregisterResizeHandler: function (handler) { return window.removeEventListener('resize', handler); },
                notifyInput: function () { return _this.emit(strings$6.INPUT_EVENT, _this); },
                notifyChange: function () { return _this.emit(strings$6.CHANGE_EVENT, _this); },
                setThumbContainerStyleProperty: function (propertyName, value) {
                    _this.thumbContainer_.style.setProperty(propertyName, value);
                },
                setTrackStyleProperty: function (propertyName, value) { return _this.track_.style.setProperty(propertyName, value); },
                setMarkerValue: function (value) { return _this.pinValueMarker_.innerText = value.toLocaleString(); },
                appendTrackMarkers: function (numMarkers) {
                    var frag = document.createDocumentFragment();
                    for (var i = 0; i < numMarkers; i++) {
                        var marker = document.createElement('div');
                        marker.classList.add('mdc-slider__track-marker');
                        frag.appendChild(marker);
                    }
                    _this.trackMarkerContainer_.appendChild(frag);
                },
                removeTrackMarkers: function () {
                    while (_this.trackMarkerContainer_.firstChild) {
                        _this.trackMarkerContainer_.removeChild(_this.trackMarkerContainer_.firstChild);
                    }
                },
                setLastTrackMarkersStyleProperty: function (propertyName, value) {
                    // We remove and append new nodes, thus, the last track marker must be dynamically found.
                    var lastTrackMarker = _this.root_.querySelector(strings$6.LAST_TRACK_MARKER_SELECTOR);
                    lastTrackMarker.style.setProperty(propertyName, value);
                },
                isRTL: function () { return getComputedStyle(_this.root_).direction === 'rtl'; },
            };
            // tslint:enable:object-literal-sort-keys
            return new MDCSliderFoundation(adapter);
        };
        MDCSlider.prototype.initialSyncWithDOM = function () {
            var origValueNow = this.parseFloat_(this.root_.getAttribute(strings$6.ARIA_VALUENOW), this.value);
            var min = this.parseFloat_(this.root_.getAttribute(strings$6.ARIA_VALUEMIN), this.min);
            var max = this.parseFloat_(this.root_.getAttribute(strings$6.ARIA_VALUEMAX), this.max);
            // min and max need to be set in the right order to avoid throwing an error
            // when the new min is greater than the default max.
            if (min >= this.max) {
                this.max = max;
                this.min = min;
            }
            else {
                this.min = min;
                this.max = max;
            }
            this.step = this.parseFloat_(this.root_.getAttribute(strings$6.STEP_DATA_ATTR), this.step);
            this.value = origValueNow;
            this.disabled = (this.root_.hasAttribute(strings$6.ARIA_DISABLED) &&
                this.root_.getAttribute(strings$6.ARIA_DISABLED) !== 'false');
            this.foundation_.setupTrackMarker();
        };
        MDCSlider.prototype.layout = function () {
            this.foundation_.layout();
        };
        MDCSlider.prototype.stepUp = function (amount) {
            if (amount === void 0) { amount = (this.step || 1); }
            this.value += amount;
        };
        MDCSlider.prototype.stepDown = function (amount) {
            if (amount === void 0) { amount = (this.step || 1); }
            this.value -= amount;
        };
        MDCSlider.prototype.parseFloat_ = function (str, defaultValue) {
            var num = parseFloat(str); // tslint:disable-line:ban
            var isNumeric = typeof num === 'number' && isFinite(num);
            return isNumeric ? num : defaultValue;
        };
        return MDCSlider;
    }(MDCComponent));

    /* node_modules\@smui\slider\Slider.svelte generated by Svelte v3.24.1 */

    function create_if_block_1$1(ctx) {
    	let div;

    	return {
    		c() {
    			div = element("div");
    			attr(div, "class", "mdc-slider__track-marker-container");
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    		}
    	};
    }

    // (29:4) {#if discrete}
    function create_if_block$1(ctx) {
    	let div;

    	return {
    		c() {
    			div = element("div");
    			div.innerHTML = `<span class="mdc-slider__pin-value-marker"></span>`;
    			attr(div, "class", "mdc-slider__pin");
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    		}
    	};
    }

    function create_fragment$d(ctx) {
    	let div4;
    	let div1;
    	let div0;
    	let t0;
    	let t1;
    	let div3;
    	let t2;
    	let svg;
    	let circle;
    	let t3;
    	let div2;
    	let div4_class_value;
    	let div4_aria_disabled_value;
    	let useActions_action;
    	let forwardEvents_action;
    	let mounted;
    	let dispose;
    	let if_block0 = /*discrete*/ ctx[4] && /*displayMarkers*/ ctx[5] && create_if_block_1$1();
    	let if_block1 = /*discrete*/ ctx[4] && create_if_block$1();

    	let div4_levels = [
    		{
    			class: div4_class_value = "\n    mdc-slider\n    " + /*className*/ ctx[2] + "\n    " + (/*discrete*/ ctx[4] ? "mdc-slider--discrete" : "") + "\n    " + (/*discrete*/ ctx[4] && /*displayMarkers*/ ctx[5]
    			? "mdc-slider--display-markers"
    			: "") + "\n  "
    		},
    		{ role: "slider" },
    		{
    			"aria-disabled": div4_aria_disabled_value = /*disabled*/ ctx[3] ? "true" : "false"
    		},
    		{ "aria-valuemin": /*min*/ ctx[6] },
    		{ "aria-valuemax": /*max*/ ctx[7] },
    		{ "aria-valuenow": /*value*/ ctx[0] },
    		/*step*/ ctx[8] === 0
    		? {}
    		: { "data-step": /*step*/ ctx[8] },
    		{ tabindex: /*tabindex*/ ctx[9] },
    		/*inputProps*/ ctx[12],
    		exclude(/*$$props*/ ctx[14], [
    			"use",
    			"class",
    			"disabled",
    			"discrete",
    			"displayMarkers",
    			"min",
    			"max",
    			"step",
    			"value",
    			"tabindex"
    		])
    	];

    	let div4_data = {};

    	for (let i = 0; i < div4_levels.length; i += 1) {
    		div4_data = assign(div4_data, div4_levels[i]);
    	}

    	return {
    		c() {
    			div4 = element("div");
    			div1 = element("div");
    			div0 = element("div");
    			t0 = space();
    			if (if_block0) if_block0.c();
    			t1 = space();
    			div3 = element("div");
    			if (if_block1) if_block1.c();
    			t2 = space();
    			svg = svg_element("svg");
    			circle = svg_element("circle");
    			t3 = space();
    			div2 = element("div");
    			attr(div0, "class", "mdc-slider__track");
    			attr(div1, "class", "mdc-slider__track-container");
    			attr(circle, "cx", "10.5");
    			attr(circle, "cy", "10.5");
    			attr(circle, "r", "7.875");
    			attr(svg, "class", "mdc-slider__thumb");
    			attr(svg, "width", "21");
    			attr(svg, "height", "21");
    			attr(div2, "class", "mdc-slider__focus-ring");
    			attr(div3, "class", "mdc-slider__thumb-container");
    			set_attributes(div4, div4_data);
    		},
    		m(target, anchor) {
    			insert(target, div4, anchor);
    			append(div4, div1);
    			append(div1, div0);
    			append(div1, t0);
    			if (if_block0) if_block0.m(div1, null);
    			append(div4, t1);
    			append(div4, div3);
    			if (if_block1) if_block1.m(div3, null);
    			append(div3, t2);
    			append(div3, svg);
    			append(svg, circle);
    			append(div3, t3);
    			append(div3, div2);
    			/*div4_binding*/ ctx[19](div4);

    			if (!mounted) {
    				dispose = [
    					action_destroyer(useActions_action = useActions.call(null, div4, /*use*/ ctx[1])),
    					action_destroyer(forwardEvents_action = /*forwardEvents*/ ctx[11].call(null, div4)),
    					listen(div4, "MDCSlider:input", /*handleChange*/ ctx[13])
    				];

    				mounted = true;
    			}
    		},
    		p(ctx, [dirty]) {
    			if (/*discrete*/ ctx[4] && /*displayMarkers*/ ctx[5]) {
    				if (if_block0) ; else {
    					if_block0 = create_if_block_1$1();
    					if_block0.c();
    					if_block0.m(div1, null);
    				}
    			} else if (if_block0) {
    				if_block0.d(1);
    				if_block0 = null;
    			}

    			if (/*discrete*/ ctx[4]) {
    				if (if_block1) ; else {
    					if_block1 = create_if_block$1();
    					if_block1.c();
    					if_block1.m(div3, t2);
    				}
    			} else if (if_block1) {
    				if_block1.d(1);
    				if_block1 = null;
    			}

    			set_attributes(div4, div4_data = get_spread_update(div4_levels, [
    				dirty & /*className, discrete, displayMarkers*/ 52 && div4_class_value !== (div4_class_value = "\n    mdc-slider\n    " + /*className*/ ctx[2] + "\n    " + (/*discrete*/ ctx[4] ? "mdc-slider--discrete" : "") + "\n    " + (/*discrete*/ ctx[4] && /*displayMarkers*/ ctx[5]
    				? "mdc-slider--display-markers"
    				: "") + "\n  ") && { class: div4_class_value },
    				{ role: "slider" },
    				dirty & /*disabled*/ 8 && div4_aria_disabled_value !== (div4_aria_disabled_value = /*disabled*/ ctx[3] ? "true" : "false") && {
    					"aria-disabled": div4_aria_disabled_value
    				},
    				dirty & /*min*/ 64 && { "aria-valuemin": /*min*/ ctx[6] },
    				dirty & /*max*/ 128 && { "aria-valuemax": /*max*/ ctx[7] },
    				dirty & /*value*/ 1 && { "aria-valuenow": /*value*/ ctx[0] },
    				dirty & /*step*/ 256 && (/*step*/ ctx[8] === 0
    				? {}
    				: { "data-step": /*step*/ ctx[8] }),
    				dirty & /*tabindex*/ 512 && { tabindex: /*tabindex*/ ctx[9] },
    				/*inputProps*/ ctx[12],
    				dirty & /*$$props*/ 16384 && exclude(/*$$props*/ ctx[14], [
    					"use",
    					"class",
    					"disabled",
    					"discrete",
    					"displayMarkers",
    					"min",
    					"max",
    					"step",
    					"value",
    					"tabindex"
    				])
    			]));

    			if (useActions_action && is_function(useActions_action.update) && dirty & /*use*/ 2) useActions_action.update.call(null, /*use*/ ctx[1]);
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(div4);
    			if (if_block0) if_block0.d();
    			if (if_block1) if_block1.d();
    			/*div4_binding*/ ctx[19](null);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    function instance$a($$self, $$props, $$invalidate) {
    	const forwardEvents = forwardEventsBuilder(get_current_component(), ["MDCSlider:input", "MDCSlider:change"]);
    	let { use = [] } = $$props;
    	let { class: className = "" } = $$props;
    	let { disabled = false } = $$props;
    	let { discrete = false } = $$props;
    	let { displayMarkers = false } = $$props;
    	let { min = 0 } = $$props;
    	let { max = 100 } = $$props;
    	let { step = 0 } = $$props;
    	let { value = null } = $$props;
    	let { tabindex = "0" } = $$props;
    	let element;
    	let slider;
    	let formField = getContext("SMUI:form-field");
    	let inputProps = getContext("SMUI:generic:input:props") || {};
    	let addLayoutListener = getContext("SMUI:addLayoutListener");
    	let removeLayoutListener;

    	if (addLayoutListener) {
    		removeLayoutListener = addLayoutListener(layout);
    	}

    	onMount(() => {
    		$$invalidate(20, slider = new MDCSlider(element));

    		if (formField && formField()) {
    			formField().input = slider;
    		}
    	});

    	onDestroy(() => {
    		slider && slider.destroy();

    		if (removeLayoutListener) {
    			removeLayoutListener();
    		}
    	});

    	function handleChange() {
    		$$invalidate(0, value = slider.value);
    	}

    	function layout(...args) {
    		return slider.layout(...args);
    	}

    	function stepUp(amount = 1, ...args) {
    		return slider.stepUp(amount, ...args);
    	}

    	function stepDown(amount = 1, ...args) {
    		return slider.stepDown(amount, ...args);
    	}

    	function getId() {
    		return inputProps && inputProps.id;
    	}

    	function div4_binding($$value) {
    		binding_callbacks[$$value ? "unshift" : "push"](() => {
    			element = $$value;
    			$$invalidate(10, element);
    		});
    	}

    	$$self.$$set = $$new_props => {
    		$$invalidate(14, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
    		if ("use" in $$new_props) $$invalidate(1, use = $$new_props.use);
    		if ("class" in $$new_props) $$invalidate(2, className = $$new_props.class);
    		if ("disabled" in $$new_props) $$invalidate(3, disabled = $$new_props.disabled);
    		if ("discrete" in $$new_props) $$invalidate(4, discrete = $$new_props.discrete);
    		if ("displayMarkers" in $$new_props) $$invalidate(5, displayMarkers = $$new_props.displayMarkers);
    		if ("min" in $$new_props) $$invalidate(6, min = $$new_props.min);
    		if ("max" in $$new_props) $$invalidate(7, max = $$new_props.max);
    		if ("step" in $$new_props) $$invalidate(8, step = $$new_props.step);
    		if ("value" in $$new_props) $$invalidate(0, value = $$new_props.value);
    		if ("tabindex" in $$new_props) $$invalidate(9, tabindex = $$new_props.tabindex);
    	};

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*slider, disabled*/ 1048584) {
    			 if (slider && slider.disabled !== disabled) {
    				$$invalidate(20, slider.disabled = disabled, slider);
    			}
    		}

    		if ($$self.$$.dirty & /*slider, min*/ 1048640) {
    			 if (slider && slider.min !== min) {
    				$$invalidate(20, slider.min = min, slider);
    			}
    		}

    		if ($$self.$$.dirty & /*slider, max*/ 1048704) {
    			 if (slider && slider.max !== max) {
    				$$invalidate(20, slider.max = max, slider);
    			}
    		}

    		if ($$self.$$.dirty & /*slider, step*/ 1048832) {
    			 if (slider && slider.step !== step) {
    				$$invalidate(20, slider.step = step, slider);
    			}
    		}

    		if ($$self.$$.dirty & /*slider, value*/ 1048577) {
    			 if (slider && slider.value !== value) {
    				$$invalidate(20, slider.value = value, slider);
    			}
    		}
    	};

    	$$props = exclude_internal_props($$props);

    	return [
    		value,
    		use,
    		className,
    		disabled,
    		discrete,
    		displayMarkers,
    		min,
    		max,
    		step,
    		tabindex,
    		element,
    		forwardEvents,
    		inputProps,
    		handleChange,
    		$$props,
    		layout,
    		stepUp,
    		stepDown,
    		getId,
    		div4_binding
    	];
    }

    class Slider extends SvelteComponent {
    	constructor(options) {
    		super();

    		init(this, options, instance$a, create_fragment$d, safe_not_equal, {
    			use: 1,
    			class: 2,
    			disabled: 3,
    			discrete: 4,
    			displayMarkers: 5,
    			min: 6,
    			max: 7,
    			step: 8,
    			value: 0,
    			tabindex: 9,
    			layout: 15,
    			stepUp: 16,
    			stepDown: 17,
    			getId: 18
    		});
    	}

    	get layout() {
    		return this.$$.ctx[15];
    	}

    	get stepUp() {
    		return this.$$.ctx[16];
    	}

    	get stepDown() {
    		return this.$$.ctx[17];
    	}

    	get getId() {
    		return this.$$.ctx[18];
    	}
    }

    var css_248z$4 = "@keyframes mdc-slider-emphasize {\n  0% {\n    animation-timing-function: ease-out;\n  }\n  50% {\n    animation-timing-function: ease-in;\n    transform: scale(0.85);\n  }\n  100% {\n    transform: scale(0.571);\n  }\n}\n.mdc-slider {\n  position: relative;\n  width: 100%;\n  height: 48px;\n  cursor: pointer;\n  touch-action: pan-x;\n  -webkit-tap-highlight-color: rgba(0, 0, 0, 0);\n}\n.mdc-slider:not(.mdc-slider--disabled) .mdc-slider__track {\n  background-color: #018786;\n  /* @alternate */\n  background-color: var(--mdc-theme-secondary, #018786);\n}\n.mdc-slider:not(.mdc-slider--disabled) .mdc-slider__track-container {\n  background-color: rgba(1, 135, 134, 0.26);\n}\n.mdc-slider:not(.mdc-slider--disabled) .mdc-slider__track-marker::after,\n.mdc-slider:not(.mdc-slider--disabled) .mdc-slider__track-marker-container::after {\n  background-color: #018786;\n  /* @alternate */\n  background-color: var(--mdc-theme-secondary, #018786);\n}\n.mdc-slider:not(.mdc-slider--disabled) .mdc-slider__thumb {\n  fill: #018786;\n  /* @alternate */\n  fill: var(--mdc-theme-secondary, #018786);\n  stroke: #018786;\n  /* @alternate */\n  stroke: var(--mdc-theme-secondary, #018786);\n}\n.mdc-slider:not(.mdc-slider--disabled) .mdc-slider__focus-ring {\n  background-color: #018786;\n  /* @alternate */\n  background-color: var(--mdc-theme-secondary, #018786);\n}\n.mdc-slider:not(.mdc-slider--disabled) .mdc-slider__pin {\n  background-color: #018786;\n  /* @alternate */\n  background-color: var(--mdc-theme-secondary, #018786);\n}\n.mdc-slider:not(.mdc-slider--disabled) .mdc-slider__pin {\n  color: white;\n  /* @alternate */\n  color: var(--mdc-theme-text-primary-on-dark, white);\n}\n.mdc-slider--disabled {\n  cursor: auto;\n}\n.mdc-slider--disabled .mdc-slider__track {\n  background-color: #9a9a9a;\n}\n.mdc-slider--disabled .mdc-slider__track-container {\n  background-color: rgba(154, 154, 154, 0.26);\n}\n.mdc-slider--disabled .mdc-slider__track-marker::after,\n.mdc-slider--disabled .mdc-slider__track-marker-container::after {\n  background-color: #9a9a9a;\n}\n.mdc-slider--disabled .mdc-slider__thumb {\n  fill: #9a9a9a;\n  stroke: #9a9a9a;\n}\n.mdc-slider--disabled .mdc-slider__thumb {\n  /* @alternate */\n  stroke: white;\n  stroke: var(--mdc-slider-bg-color-behind-component, white);\n}\n.mdc-slider:focus {\n  outline: none;\n}\n.mdc-slider__track-container {\n  position: absolute;\n  top: 50%;\n  width: 100%;\n  height: 2px;\n  overflow: hidden;\n}\n.mdc-slider__track {\n  position: absolute;\n  width: 100%;\n  height: 100%;\n  transform-origin: left top;\n  will-change: transform;\n}\n.mdc-slider[dir=rtl] .mdc-slider__track, [dir=rtl] .mdc-slider .mdc-slider__track {\n  transform-origin: right top;\n}\n\n.mdc-slider__track-marker-container {\n  display: flex;\n  margin-right: 0;\n  margin-left: -1px;\n  visibility: hidden;\n}\n.mdc-slider[dir=rtl] .mdc-slider__track-marker-container, [dir=rtl] .mdc-slider .mdc-slider__track-marker-container {\n  margin-right: -1px;\n  margin-left: 0;\n}\n\n.mdc-slider__track-marker-container::after {\n  display: block;\n  width: 2px;\n  height: 2px;\n  content: \"\";\n}\n.mdc-slider__track-marker {\n  flex: 1;\n}\n.mdc-slider__track-marker::after {\n  display: block;\n  width: 2px;\n  height: 2px;\n  content: \"\";\n}\n.mdc-slider__track-marker:first-child::after {\n  width: 3px;\n}\n.mdc-slider__thumb-container {\n  position: absolute;\n  top: 15px;\n  left: 0;\n  width: 21px;\n  height: 100%;\n  user-select: none;\n  will-change: transform;\n}\n.mdc-slider__thumb {\n  position: absolute;\n  top: 0;\n  left: 0;\n  transform: scale(0.571);\n  stroke-width: 3.5;\n  transition: transform 100ms ease-out, fill 100ms ease-out, stroke 100ms ease-out;\n}\n.mdc-slider__focus-ring {\n  width: 21px;\n  height: 21px;\n  border-radius: 50%;\n  opacity: 0;\n  transition: transform 266.67ms ease-out, opacity 266.67ms ease-out, background-color 266.67ms ease-out;\n}\n.mdc-slider__pin {\n  display: flex;\n  position: absolute;\n  top: 0;\n  left: 0;\n  align-items: center;\n  justify-content: center;\n  width: 26px;\n  height: 26px;\n  margin-top: -2px;\n  margin-left: -2px;\n  transform: rotate(-45deg) scale(0) translate(0, 0);\n  border-radius: 50% 50% 50% 0%;\n  z-index: 1;\n  transition: transform 100ms ease-out;\n}\n.mdc-slider__pin-value-marker {\n  font-family: Roboto, sans-serif;\n  -moz-osx-font-smoothing: grayscale;\n  -webkit-font-smoothing: antialiased;\n  font-size: 0.875rem;\n  line-height: 1.25rem;\n  font-weight: 400;\n  letter-spacing: 0.0178571429em;\n  text-decoration: inherit;\n  text-transform: inherit;\n  transform: rotate(45deg);\n}\n\n.mdc-slider--active .mdc-slider__thumb {\n  transform: scale3d(1, 1, 1);\n}\n\n.mdc-slider--focus .mdc-slider__thumb {\n  animation: mdc-slider-emphasize 266.67ms linear;\n}\n.mdc-slider--focus .mdc-slider__focus-ring {\n  transform: scale3d(1.55, 1.55, 1.55);\n  opacity: 0.25;\n}\n\n.mdc-slider--in-transit .mdc-slider__thumb {\n  transition-delay: 140ms;\n}\n\n.mdc-slider--in-transit .mdc-slider__thumb-container,\n.mdc-slider--in-transit .mdc-slider__track,\n.mdc-slider:focus:not(.mdc-slider--active) .mdc-slider__thumb-container,\n.mdc-slider:focus:not(.mdc-slider--active) .mdc-slider__track {\n  transition: transform 80ms ease;\n}\n\n.mdc-slider--discrete.mdc-slider--active .mdc-slider__thumb {\n  transform: scale(calc(12 / 21));\n}\n.mdc-slider--discrete.mdc-slider--active .mdc-slider__pin {\n  transform: rotate(-45deg) scale(1) translate(19px, -20px);\n}\n.mdc-slider--discrete.mdc-slider--focus .mdc-slider__thumb {\n  animation: none;\n}\n.mdc-slider--discrete.mdc-slider--display-markers .mdc-slider__track-marker-container {\n  visibility: visible;\n}\n";
    styleInject(css_248z$4);

    /* src\components\Settings.svelte generated by Svelte v3.24.1 */

    function create_fragment$e(ctx) {
    	let form;
    	let p0;
    	let t1;
    	let div0;
    	let slider0;
    	let updating_value;
    	let t2;
    	let span0;
    	let t3;
    	let t4;
    	let p1;
    	let t6;
    	let div1;
    	let slider1;
    	let updating_value_1;
    	let t7;
    	let span1;
    	let t8;
    	let t9;
    	let p2;
    	let t11;
    	let div2;
    	let slider2;
    	let updating_value_2;
    	let t12;
    	let span2;
    	let t13;
    	let t14;
    	let p3;
    	let t16;
    	let div3;
    	let slider3;
    	let updating_value_3;
    	let t17;
    	let span3;
    	let t18;
    	let current;

    	function slider0_value_binding(value) {
    		/*slider0_value_binding*/ ctx[4].call(null, value);
    	}

    	let slider0_props = { min: 1, max: 60, discrete: true };

    	if (/*$workDur*/ ctx[0] !== void 0) {
    		slider0_props.value = /*$workDur*/ ctx[0];
    	}

    	slider0 = new Slider({ props: slider0_props });
    	binding_callbacks.push(() => bind(slider0, "value", slider0_value_binding));

    	function slider1_value_binding(value) {
    		/*slider1_value_binding*/ ctx[5].call(null, value);
    	}

    	let slider1_props = { min: 1, max: 60, discrete: true };

    	if (/*$breakDur*/ ctx[1] !== void 0) {
    		slider1_props.value = /*$breakDur*/ ctx[1];
    	}

    	slider1 = new Slider({ props: slider1_props });
    	binding_callbacks.push(() => bind(slider1, "value", slider1_value_binding));

    	function slider2_value_binding(value) {
    		/*slider2_value_binding*/ ctx[6].call(null, value);
    	}

    	let slider2_props = { min: 1, max: 60, discrete: true };

    	if (/*$longBreakDur*/ ctx[2] !== void 0) {
    		slider2_props.value = /*$longBreakDur*/ ctx[2];
    	}

    	slider2 = new Slider({ props: slider2_props });
    	binding_callbacks.push(() => bind(slider2, "value", slider2_value_binding));

    	function slider3_value_binding(value) {
    		/*slider3_value_binding*/ ctx[7].call(null, value);
    	}

    	let slider3_props = { min: 1, max: 10, discrete: true };

    	if (/*$noOfSession*/ ctx[3] !== void 0) {
    		slider3_props.value = /*$noOfSession*/ ctx[3];
    	}

    	slider3 = new Slider({ props: slider3_props });
    	binding_callbacks.push(() => bind(slider3, "value", slider3_value_binding));

    	return {
    		c() {
    			form = element("form");
    			p0 = element("p");
    			p0.textContent = "Work Time";
    			t1 = space();
    			div0 = element("div");
    			create_component(slider0.$$.fragment);
    			t2 = space();
    			span0 = element("span");
    			t3 = text(/*$workDur*/ ctx[0]);
    			t4 = space();
    			p1 = element("p");
    			p1.textContent = "Break Time";
    			t6 = space();
    			div1 = element("div");
    			create_component(slider1.$$.fragment);
    			t7 = space();
    			span1 = element("span");
    			t8 = text(/*$breakDur*/ ctx[1]);
    			t9 = space();
    			p2 = element("p");
    			p2.textContent = "Long Break Time";
    			t11 = space();
    			div2 = element("div");
    			create_component(slider2.$$.fragment);
    			t12 = space();
    			span2 = element("span");
    			t13 = text(/*$longBreakDur*/ ctx[2]);
    			t14 = space();
    			p3 = element("p");
    			p3.textContent = "Session";
    			t16 = space();
    			div3 = element("div");
    			create_component(slider3.$$.fragment);
    			t17 = space();
    			span3 = element("span");
    			t18 = text(/*$noOfSession*/ ctx[3]);
    			attr(span0, "class", "svelte-146o8my");
    			attr(div0, "class", "form-container svelte-146o8my");
    			attr(span1, "class", "svelte-146o8my");
    			attr(div1, "class", "form-container svelte-146o8my");
    			attr(span2, "class", "svelte-146o8my");
    			attr(div2, "class", "form-container svelte-146o8my");
    			attr(span3, "class", "svelte-146o8my");
    			attr(div3, "class", "form-container svelte-146o8my");
    			attr(form, "class", "svelte-146o8my");
    		},
    		m(target, anchor) {
    			insert(target, form, anchor);
    			append(form, p0);
    			append(form, t1);
    			append(form, div0);
    			mount_component(slider0, div0, null);
    			append(div0, t2);
    			append(div0, span0);
    			append(span0, t3);
    			append(form, t4);
    			append(form, p1);
    			append(form, t6);
    			append(form, div1);
    			mount_component(slider1, div1, null);
    			append(div1, t7);
    			append(div1, span1);
    			append(span1, t8);
    			append(form, t9);
    			append(form, p2);
    			append(form, t11);
    			append(form, div2);
    			mount_component(slider2, div2, null);
    			append(div2, t12);
    			append(div2, span2);
    			append(span2, t13);
    			append(form, t14);
    			append(form, p3);
    			append(form, t16);
    			append(form, div3);
    			mount_component(slider3, div3, null);
    			append(div3, t17);
    			append(div3, span3);
    			append(span3, t18);
    			current = true;
    		},
    		p(ctx, [dirty]) {
    			const slider0_changes = {};

    			if (!updating_value && dirty & /*$workDur*/ 1) {
    				updating_value = true;
    				slider0_changes.value = /*$workDur*/ ctx[0];
    				add_flush_callback(() => updating_value = false);
    			}

    			slider0.$set(slider0_changes);
    			if (!current || dirty & /*$workDur*/ 1) set_data(t3, /*$workDur*/ ctx[0]);
    			const slider1_changes = {};

    			if (!updating_value_1 && dirty & /*$breakDur*/ 2) {
    				updating_value_1 = true;
    				slider1_changes.value = /*$breakDur*/ ctx[1];
    				add_flush_callback(() => updating_value_1 = false);
    			}

    			slider1.$set(slider1_changes);
    			if (!current || dirty & /*$breakDur*/ 2) set_data(t8, /*$breakDur*/ ctx[1]);
    			const slider2_changes = {};

    			if (!updating_value_2 && dirty & /*$longBreakDur*/ 4) {
    				updating_value_2 = true;
    				slider2_changes.value = /*$longBreakDur*/ ctx[2];
    				add_flush_callback(() => updating_value_2 = false);
    			}

    			slider2.$set(slider2_changes);
    			if (!current || dirty & /*$longBreakDur*/ 4) set_data(t13, /*$longBreakDur*/ ctx[2]);
    			const slider3_changes = {};

    			if (!updating_value_3 && dirty & /*$noOfSession*/ 8) {
    				updating_value_3 = true;
    				slider3_changes.value = /*$noOfSession*/ ctx[3];
    				add_flush_callback(() => updating_value_3 = false);
    			}

    			slider3.$set(slider3_changes);
    			if (!current || dirty & /*$noOfSession*/ 8) set_data(t18, /*$noOfSession*/ ctx[3]);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(slider0.$$.fragment, local);
    			transition_in(slider1.$$.fragment, local);
    			transition_in(slider2.$$.fragment, local);
    			transition_in(slider3.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(slider0.$$.fragment, local);
    			transition_out(slider1.$$.fragment, local);
    			transition_out(slider2.$$.fragment, local);
    			transition_out(slider3.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(form);
    			destroy_component(slider0);
    			destroy_component(slider1);
    			destroy_component(slider2);
    			destroy_component(slider3);
    		}
    	};
    }

    function instance$b($$self, $$props, $$invalidate) {
    	let $workDur;
    	let $breakDur;
    	let $longBreakDur;
    	let $noOfSession;
    	component_subscribe($$self, workDur, $$value => $$invalidate(0, $workDur = $$value));
    	component_subscribe($$self, breakDur, $$value => $$invalidate(1, $breakDur = $$value));
    	component_subscribe($$self, longBreakDur, $$value => $$invalidate(2, $longBreakDur = $$value));
    	component_subscribe($$self, noOfSession, $$value => $$invalidate(3, $noOfSession = $$value));

    	function slider0_value_binding(value) {
    		$workDur = value;
    		workDur.set($workDur);
    	}

    	function slider1_value_binding(value) {
    		$breakDur = value;
    		breakDur.set($breakDur);
    	}

    	function slider2_value_binding(value) {
    		$longBreakDur = value;
    		longBreakDur.set($longBreakDur);
    	}

    	function slider3_value_binding(value) {
    		$noOfSession = value;
    		noOfSession.set($noOfSession);
    	}

    	return [
    		$workDur,
    		$breakDur,
    		$longBreakDur,
    		$noOfSession,
    		slider0_value_binding,
    		slider1_value_binding,
    		slider2_value_binding,
    		slider3_value_binding
    	];
    }

    class Settings extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$b, create_fragment$e, safe_not_equal, {});
    	}
    }

    /* src\App.svelte generated by Svelte v3.24.1 */

    function create_default_slot_3$1(ctx) {
    	let t_value = /*tab*/ ctx[2] + "";
    	let t;

    	return {
    		c() {
    			t = text(t_value);
    		},
    		m(target, anchor) {
    			insert(target, t, anchor);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*tab*/ 4 && t_value !== (t_value = /*tab*/ ctx[2] + "")) set_data(t, t_value);
    		},
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (32:16) <Tab {tab}>
    function create_default_slot_2$1(ctx) {
    	let label;
    	let current;

    	label = new Label({
    			props: {
    				$$slots: { default: [create_default_slot_3$1] },
    				$$scope: { ctx }
    			}
    		});

    	return {
    		c() {
    			create_component(label.$$.fragment);
    		},
    		m(target, anchor) {
    			mount_component(label, target, anchor);
    			current = true;
    		},
    		p(ctx, dirty) {
    			const label_changes = {};

    			if (dirty & /*$$scope, tab*/ 12) {
    				label_changes.$$scope = { dirty, ctx };
    			}

    			label.$set(label_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(label.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(label.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(label, detaching);
    		}
    	};
    }

    // (31:12) <TabBar tabs={['Clock', 'Setting']} let:tab bind:active>
    function create_default_slot_1$2(ctx) {
    	let tab;
    	let current;

    	tab = new Tab({
    			props: {
    				tab: /*tab*/ ctx[2],
    				$$slots: { default: [create_default_slot_2$1] },
    				$$scope: { ctx }
    			}
    		});

    	return {
    		c() {
    			create_component(tab.$$.fragment);
    		},
    		m(target, anchor) {
    			mount_component(tab, target, anchor);
    			current = true;
    		},
    		p(ctx, dirty) {
    			const tab_changes = {};
    			if (dirty & /*tab*/ 4) tab_changes.tab = /*tab*/ ctx[2];

    			if (dirty & /*$$scope, tab*/ 12) {
    				tab_changes.$$scope = { dirty, ctx };
    			}

    			tab.$set(tab_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(tab.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(tab.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(tab, detaching);
    		}
    	};
    }

    // (38:12) {:else}
    function create_else_block(ctx) {
    	let settings;
    	let current;
    	settings = new Settings({});

    	return {
    		c() {
    			create_component(settings.$$.fragment);
    		},
    		m(target, anchor) {
    			mount_component(settings, target, anchor);
    			current = true;
    		},
    		i(local) {
    			if (current) return;
    			transition_in(settings.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(settings.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(settings, detaching);
    		}
    	};
    }

    // (36:12) {#if active == 'Clock'}
    function create_if_block$2(ctx) {
    	let countdown;
    	let current;
    	countdown = new CountDown({});

    	return {
    		c() {
    			create_component(countdown.$$.fragment);
    		},
    		m(target, anchor) {
    			mount_component(countdown, target, anchor);
    			current = true;
    		},
    		i(local) {
    			if (current) return;
    			transition_in(countdown.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(countdown.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(countdown, detaching);
    		}
    	};
    }

    // (30:8) <Card>
    function create_default_slot$4(ctx) {
    	let tabbar;
    	let updating_active;
    	let t;
    	let current_block_type_index;
    	let if_block;
    	let if_block_anchor;
    	let current;

    	function tabbar_active_binding(value) {
    		/*tabbar_active_binding*/ ctx[1].call(null, value);
    	}

    	let tabbar_props = {
    		tabs: ["Clock", "Setting"],
    		$$slots: {
    			default: [create_default_slot_1$2, ({ tab }) => ({ 2: tab }), ({ tab }) => tab ? 4 : 0]
    		},
    		$$scope: { ctx }
    	};

    	if (/*active*/ ctx[0] !== void 0) {
    		tabbar_props.active = /*active*/ ctx[0];
    	}

    	tabbar = new TabBar({ props: tabbar_props });
    	binding_callbacks.push(() => bind(tabbar, "active", tabbar_active_binding));
    	const if_block_creators = [create_if_block$2, create_else_block];
    	const if_blocks = [];

    	function select_block_type(ctx, dirty) {
    		if (/*active*/ ctx[0] == "Clock") return 0;
    		return 1;
    	}

    	current_block_type_index = select_block_type(ctx);
    	if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);

    	return {
    		c() {
    			create_component(tabbar.$$.fragment);
    			t = space();
    			if_block.c();
    			if_block_anchor = empty();
    		},
    		m(target, anchor) {
    			mount_component(tabbar, target, anchor);
    			insert(target, t, anchor);
    			if_blocks[current_block_type_index].m(target, anchor);
    			insert(target, if_block_anchor, anchor);
    			current = true;
    		},
    		p(ctx, dirty) {
    			const tabbar_changes = {};

    			if (dirty & /*$$scope, tab*/ 12) {
    				tabbar_changes.$$scope = { dirty, ctx };
    			}

    			if (!updating_active && dirty & /*active*/ 1) {
    				updating_active = true;
    				tabbar_changes.active = /*active*/ ctx[0];
    				add_flush_callback(() => updating_active = false);
    			}

    			tabbar.$set(tabbar_changes);
    			let previous_block_index = current_block_type_index;
    			current_block_type_index = select_block_type(ctx);

    			if (current_block_type_index !== previous_block_index) {
    				group_outros();

    				transition_out(if_blocks[previous_block_index], 1, 1, () => {
    					if_blocks[previous_block_index] = null;
    				});

    				check_outros();
    				if_block = if_blocks[current_block_type_index];

    				if (!if_block) {
    					if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);
    					if_block.c();
    				}

    				transition_in(if_block, 1);
    				if_block.m(if_block_anchor.parentNode, if_block_anchor);
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(tabbar.$$.fragment, local);
    			transition_in(if_block);
    			current = true;
    		},
    		o(local) {
    			transition_out(tabbar.$$.fragment, local);
    			transition_out(if_block);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(tabbar, detaching);
    			if (detaching) detach(t);
    			if_blocks[current_block_type_index].d(detaching);
    			if (detaching) detach(if_block_anchor);
    		}
    	};
    }

    function create_fragment$f(ctx) {
    	let main;
    	let div;
    	let card;
    	let current;

    	card = new Card({
    			props: {
    				$$slots: { default: [create_default_slot$4] },
    				$$scope: { ctx }
    			}
    		});

    	return {
    		c() {
    			main = element("main");
    			div = element("div");
    			create_component(card.$$.fragment);
    			attr(div, "class", "container svelte-1mrjax5");
    			attr(main, "class", "svelte-1mrjax5");
    		},
    		m(target, anchor) {
    			insert(target, main, anchor);
    			append(main, div);
    			mount_component(card, div, null);
    			current = true;
    		},
    		p(ctx, [dirty]) {
    			const card_changes = {};

    			if (dirty & /*$$scope, active*/ 9) {
    				card_changes.$$scope = { dirty, ctx };
    			}

    			card.$set(card_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(card.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(card.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(main);
    			destroy_component(card);
    		}
    	};
    }

    function instance$c($$self, $$props, $$invalidate) {
    	let active = "Clock";

    	function tabbar_active_binding(value) {
    		active = value;
    		$$invalidate(0, active);
    	}

    	return [active, tabbar_active_binding];
    }

    class App extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$c, create_fragment$f, safe_not_equal, {});
    	}
    }

    const app = new App({
        target: document.body,
    });

    return app;

}());
//# sourceMappingURL=bundle.js.map
