// ==UserScript==
// @name         中科大教学评价自动完成
// @namespace    https://tqm.ustc.edu.cn
// @version      1.1
// @description  自动完成期末评教：单选/多选选第一项，忽略多余教师/助教
// @author       Hermes Agent
// @match        https://tqm.ustc.edu.cn/index.html*
// @icon         https://tqm.ustc.edu.cn/favicon.ico
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    console.log('[AutoEval] 脚本已加载');

    // ============================================================
    //  配置
    // ============================================================
    const DELAY = {
        CLICK:       500,   // 点击后的短暂等待
        TAB_SWITCH:  800,   // 切换 tab 后等渲染
        SUBMIT_WAIT: 1500,  // 提交后等后端处理
        IGNORE_WAIT: 800,   // 忽略后等处理
        NEXT_COURSE: 2500,  // 切换课程后等新页面加载
        POLL_INTERVAL: 200, // 轮询间隔
        POLL_TIMEOUT:  8000, // 轮询超时
    };

    // ============================================================
    //  工具函数
    // ============================================================

    /** 等待指定毫秒 */
    function wait(ms) {
        return new Promise(r => setTimeout(r, ms));
    }

    /** 轮询等待某个选择器出现 */
    async function waitForSelector(selector, timeout = DELAY.POLL_TIMEOUT) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const el = document.querySelector(selector);
            if (el) return el;
            await wait(DELAY.POLL_INTERVAL);
        }
        throw new Error(`超时等待选择器: ${selector}`);
    }

    /** 判断当前是否在评价页面 */
    function isOnEvaluationPage() {
        return window.location.hash.includes('/my-task/answer/');
    }

    /** 获取当前页面所有教师/助教 tab */
    function getTabs() {
        const tabs = document.querySelectorAll('[role="tab"]');
        const teachers = [];
        const assistants = [];
        tabs.forEach(tab => {
            const name = tab.textContent.trim();
            if (name.startsWith('助教-')) {
                assistants.push(tab);
            } else {
                teachers.push(tab);
            }
        });
        return { teachers, assistants };
    }

    /** 切换到一个 tab（如果尚未选中） */
    async function switchToTab(tab) {
        if (tab.getAttribute('aria-selected') === 'true') {
            return; // 已经是当前 tab
        }
        tab.click();
        await wait(DELAY.TAB_SWITCH);
    }

    // ============================================================
    //  评价操作
    // ============================================================

    /** 填写单选题：每组 radio 选第一个选项 */
    function fillRadioGroups() {
        const groups = document.querySelectorAll('.ant-radio-group');
        if (!groups.length) {
            console.warn('[AutoEval] 未找到 radio group');
            return;
        }
        let filled = 0;
        groups.forEach(group => {
            const firstWrapper = group.querySelector('.ant-radio-wrapper');
            if (firstWrapper) {
                // 检查这个组内是否已有选项被选中
                const checkedRadio = group.querySelector('input[type="radio"]:checked');
                if (!checkedRadio) {
                    firstWrapper.click();
                    filled++;
                }
            } else {
                // fallback：直接点第一个 radio
                const firstRadio = group.querySelector('input[type="radio"]');
                if (firstRadio && !firstRadio.checked) {
                    firstRadio.click();
                    filled++;
                }
            }
        });
        console.log(`[AutoEval] 已填写 ${filled} 组单选题`);
    }

    /** 填写多选题：每组 checkbox 勾选第一个选项 */
    function fillCheckboxGroups() {
        const groups = document.querySelectorAll('.ant-checkbox-group');
        if (!groups.length) {
            // 页面没有多选题属正常情况，静默返回
            return;
        }
        let filled = 0;
        groups.forEach(group => {
            const firstWrapper = group.querySelector('.ant-checkbox-wrapper');
            if (firstWrapper) {
                // 检查这个组内是否已有选项被勾选
                const checkedBox = group.querySelector('input[type="checkbox"]:checked');
                if (!checkedBox) {
                    firstWrapper.click();
                    filled++;
                }
            } else {
                // fallback：直接点第一个 checkbox
                const firstCheckbox = group.querySelector('input[type="checkbox"]');
                if (firstCheckbox && !firstCheckbox.checked) {
                    firstCheckbox.click();
                    filled++;
                }
            }
        });
        console.log(`[AutoEval] 已填写 ${filled} 组多选题`);
    }

    /** 清空问答题（仅清空空文本框，非空则跳过——避免覆盖用户手动输入） */
    function clearTextarea() {
        const ta = document.querySelector('textarea');
        if (!ta) {
            console.warn('[AutoEval] 未找到 textarea');
            return;
        }
        if (ta.value !== '') {
            console.warn('[AutoEval] 检测到文本框已有内容，跳过清空以免覆盖用户输入');
            return;
        }
        // 文本框为空，无需操作
        console.log('[AutoEval] 问答题无需清空（已为空）');
    }

    /** 点击忽略问卷按钮 */
    function clickIgnore() {
        // 遍历所有可见 span 查找"忽略问卷"文本
        const allSpans = document.querySelectorAll('span');
        for (const span of allSpans) {
            if (span.textContent.trim() === '忽略问卷' && span.offsetParent !== null) {
                span.click();
                console.log('[AutoEval] 点击了"忽略问卷"');
                return true;
            }
        }
        console.warn('[AutoEval] 未找到"忽略问卷"按钮');
        return false;
    }

    /** 点击提交按钮 */
    function clickSubmit() {
        const submitBtn = document.querySelector('button.ant-btn-primary');
        if (submitBtn && submitBtn.textContent.trim() === '提 交') {
            submitBtn.click();
            console.log('[AutoEval] 点击了"提 交"');
            return true;
        }
        console.warn('[AutoEval] 未找到提交按钮');
        return false;
    }

    /** 处理提交后的弹窗：优先点击"下一位教师"，没有则点"确定" */
    async function handleSubmitModal() {
        try {
            // 等待弹窗出现
            await waitForSelector('.ant-modal', 5000);
            await wait(500);

            // 查找"下一位教师"按钮
            const allBtns = document.querySelectorAll('.ant-modal button');
            let nextBtn = null;
            let confirmBtn = null;
            for (const btn of allBtns) {
                const text = btn.textContent.trim();
                if (text === '下一位教师') nextBtn = btn;
                if (text === '确 定') confirmBtn = btn;
            }

            if (nextBtn) {
                nextBtn.click();
                console.log('[AutoEval] 弹窗 → 点击"下一位教师"');
                await wait(DELAY.TAB_SWITCH);
                return 'next';
            } else if (confirmBtn) {
                confirmBtn.click();
                console.log('[AutoEval] 弹窗 → 点击"确 定"（已是最后一位）');
                await wait(DELAY.CLICK);
                return 'done';
            }
        } catch (e) {
            console.warn('[AutoEval] 弹窗处理超时或异常:', e);
        }
        return 'unknown';
    }

    /** 点击下一课程按钮 */
    function clickNextCourse() {
        const nextBtn = document.querySelector('button.ant-btn:not(.ant-btn-primary)');
        if (nextBtn && nextBtn.textContent.trim() === '下一课程') {
            nextBtn.click();
            console.log('[AutoEval] 点击了"下一课程"');
            return true;
        }
        console.warn('[AutoEval] 未找到"下一课程"按钮，可能已是最后一门课');
        return false;
    }

    // ============================================================
    //  状态与控制器
    // ============================================================
    let running = false;
    let stopRequested = false;

    // ============================================================
    //  UI：浮动控制按钮
    // ============================================================

    function createControlButton() {
        const btn = document.createElement('div');
        btn.id = 'hermes-eval-control';
        btn.innerHTML = `
            <style>
                #hermes-eval-control {
                    position: fixed;
                    bottom: 24px;
                    right: 24px;
                    z-index: 999999;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 0 18px;
                    height: 40px;
                    border-radius: 20px;
                    background: #1890ff;
                    color: #fff;
                    font-size: 14px;
                    font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
                    cursor: pointer;
                    box-shadow: 0 4px 14px rgba(24,144,255,0.35);
                    user-select: none;
                    transition: all 0.25s ease;
                    white-space: nowrap;
                }
                #hermes-eval-control:hover {
                    transform: translateY(-1px);
                    box-shadow: 0 6px 20px rgba(24,144,255,0.45);
                }
                #hermes-eval-control.idle {
                    background: #1890ff;
                }
                #hermes-eval-control.running {
                    background: #ff4d4f;
                    box-shadow: 0 4px 14px rgba(255,77,79,0.35);
                }
                #hermes-eval-control.running:hover {
                    box-shadow: 0 6px 20px rgba(255,77,79,0.45);
                }
                #hermes-eval-control .dot {
                    display: inline-block;
                    width: 8px;
                    height: 8px;
                    border-radius: 50%;
                    background: currentColor;
                    transition: all 0.25s;
                }
                #hermes-eval-control.running .dot {
                    background: #fff;
                    animation: pulse 1.2s ease-in-out infinite;
                }
                @keyframes pulse {
                    0%, 100% { opacity: 1; transform: scale(1); }
                    50% { opacity: 0.4; transform: scale(0.85); }
                }
                #hermes-eval-status {
                    position: fixed;
                    bottom: 72px;
                    right: 24px;
                    z-index: 999998;
                    background: rgba(0,0,0,0.75);
                    color: #fff;
                    padding: 8px 14px;
                    border-radius: 8px;
                    font-size: 12px;
                    font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
                    line-height: 1.5;
                    max-width: 280px;
                    backdrop-filter: blur(4px);
                    opacity: 0;
                    transition: opacity 0.3s;
                    pointer-events: none;
                }
                #hermes-eval-status.show {
                    opacity: 1;
                }
            </style>
            <span class="dot"></span>
            <span class="label">开始评价</span>
        `;

        const status = document.createElement('div');
        status.id = 'hermes-eval-status';
        status.textContent = '就绪';

        document.body.appendChild(btn);
        document.body.appendChild(status);

        btn.addEventListener('click', () => {
            if (running) {
                stopRequested = true;
                // 按钮显示"停止中…"而非直接切回"开始评价",
                // 避免 run() 退出前用户误点触发第二次停止指令
                const label = btn.querySelector('.label');
                if (label) label.textContent = '停止中…';
                btn.style.pointerEvents = 'none';
                console.log('[AutoEval] ⏹ 用户请求停止');
            } else {
                stopRequested = false;
                if (!isOnEvaluationPage()) {
                    setStatus('请先进入评价页面（我的任务 → 点击评价）');
                    btn.style.animation = 'none';
                    setTimeout(() => btn.style.animation = '', 500);
                    return;
                }
                run();
            }
        });

        return { btn, status };
    }

    function updateButtonState(isRunning) {
        const btn = document.getElementById('hermes-eval-control');
        if (!btn) return;
        const label = btn.querySelector('.label');
        btn.classList.toggle('running', isRunning);
        btn.classList.toggle('idle', !isRunning);
        label.textContent = isRunning ? '停止' : '开始评价';
        if (!isRunning) {
            btn.style.pointerEvents = ''; // 恢复点击，run()退出后按钮可再点击
        }
    }

    function setStatus(msg) {
        const el = document.getElementById('hermes-eval-status');
        if (!el) return;
        el.textContent = msg;
        el.classList.add('show');
    }

    function hideStatus() {
        const el = document.getElementById('hermes-eval-status');
        if (el) el.classList.remove('show');
    }

    // ============================================================
    //  核心流程
    // ============================================================

    /** 检查是否请求停止（供 processTab / processCurrentCourse 内部调用） */
    function checkStop() {
        if (stopRequested) {
            console.log('[AutoEval] 检测到停止请求，中断当前操作');
            return true;
        }
        return false;
    }

    /** 处理一个 tab：评价或忽略 */
    async function processTab(tab, action) {
        if (checkStop()) return 'stopped';
        await switchToTab(tab);
        await wait(DELAY.CLICK);

        if (action === 'evaluate') {
            const name = tab.textContent.trim();
            console.log(`[AutoEval] → 评价: ${name}`);
            if (checkStop()) return 'stopped';
            fillRadioGroups();
            if (checkStop()) return 'stopped';
            fillCheckboxGroups();
            if (checkStop()) return 'stopped';
            clearTextarea();
            await wait(DELAY.CLICK);
            if (checkStop()) return 'stopped';
            clickSubmit();
            // 处理提交后的弹窗
            const result = await handleSubmitModal(); // 'next' | 'done' | 'unknown'
            // 如果点击了"下一位教师"，页面已自动切换到下一个 tab
            // 调用者无需额外操作
            return result;
        } else if (action === 'ignore') {
            const name = tab.textContent.trim();
            console.log(`[AutoEval] → 忽略: ${name}`);
            clickIgnore();
            await wait(DELAY.IGNORE_WAIT);
            return 'ignored';
        }
    }

    /** 处理当前课程的所有 tab */
    async function processCurrentCourse() {
        // 等待 radio group 渲染完成
        try {
            await waitForSelector('.ant-radio-group', DELAY.POLL_TIMEOUT);
        } catch {
            console.warn('[AutoEval] 页面可能没有问卷，尝试继续...');
        }

        const { teachers, assistants } = getTabs();
        console.log(`[AutoEval] 当前课程: 教师 ${teachers.length} 人, 助教 ${assistants.length} 人`);

        // ---- 处理教师 ----
        if (teachers.length > 0) {
            // 评价第一位教师
            let result = await processTab(teachers[0], 'evaluate');
            if (result === 'stopped') return 'stopped';
            // 忽略其余教师
            for (let i = 1; i < teachers.length; i++) {
                result = await processTab(teachers[i], 'ignore');
                if (result === 'stopped') return 'stopped';
            }
        } else {
            console.log('[AutoEval] 无教师 tab');
        }

        // ---- 处理助教 ----
        if (assistants.length > 0) {
            if (checkStop()) return 'stopped';
            // 评价第一位助教
            let result = await processTab(assistants[0], 'evaluate');
            if (result === 'stopped') return 'stopped';
            // 忽略其余助教
            for (let i = 1; i < assistants.length; i++) {
                result = await processTab(assistants[i], 'ignore');
                if (result === 'stopped') return 'stopped';
            }
        } else {
            console.log('[AutoEval] 无助教 tab');
        }

        // ---- 切换到下一课程 ----
        if (checkStop()) return 'stopped';
        const hasNext = clickNextCourse();
        if (hasNext) {
            await wait(DELAY.NEXT_COURSE);
            return true; // 还有下一门课
        }
        return false; // 没有下一门课了
    }

    /**
     * 运行入口（由按钮触发）
     * 与 main 分离，由 run() 直接调用，不走覆盖
     */
    async function run() {
        if (!isOnEvaluationPage()) {
            setStatus('请先进入评价页面（我的任务 → 点击评价）');
            return;
        }
        if (running) return;

        running = true;
        stopRequested = false;
        updateButtonState(true);
        setStatus('正在处理第 1 门课...');

        console.log('[AutoEval] ===== 开始自动评价 =====');
        let courseCount = 0;
        const MAX_COURSES = 20;

        while (!stopRequested) {
            if (courseCount >= MAX_COURSES) {
                console.warn(`[AutoEval] 已达最大课程数限制 (${MAX_COURSES})，停止处理`);
                setStatus(`已达最大课程数限制 (${MAX_COURSES})`);
                break;
            }
            if (!isOnEvaluationPage()) {
                setStatus('已离开评价页面，停止');
                break;
            }

            courseCount++;
            setStatus(`正在处理第 ${courseCount} 门课...`);
            console.log(`[AutoEval] === 第 ${courseCount} 门课 ===`);
            const result = await processCurrentCourse();
            const hasNext = (result === true); // true=还有课, false=无课, 'stopped'=被中断

            if (result === 'stopped' || !hasNext || stopRequested) {
                break;
            }
        }

        if (stopRequested) {
            setStatus('已停止');
            console.log('[AutoEval] ⏹ 已停止');
        } else {
            setStatus('🎉 所有课程处理完毕！');
            console.log('[AutoEval] ===== 全部完成 =====');
        }

        running = false;
        updateButtonState(false);
    }

    // ============================================================
    //  初始化：注入控制按钮（不自动执行）
    // ============================================================

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createControlButton);
    } else {
        createControlButton();
    }

})();
