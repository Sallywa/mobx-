import { Lambda, getNextId, invariant, EMPTY_OBJECT, deprecated } from "../utils/utils"
import { Reaction, IReactionPublic, IReactionDisposer } from "../core/reaction"
import { action, isAction } from "./action"
import { IEqualsComparer, comparer } from "../utils/comparer"

export interface IAutorunOptions {
    delay?: number
    name?: string
    scheduler?: (callback: () => void) => any
    onError?: (error: any) => void
}

/**
 * Creates a named reactive view and keeps it alive, so that the view is always
 * updated if one of the dependencies changes, even when the view is not further used by something else.
 * @param view The reactive view
 * @returns disposer function, which can be used to stop the view from being updated in the future.
 */
export function autorun(
    //执行的函数 ()=>{console.log('sally')}
    view: (r: IReactionPublic) => any,

    // Autorun 接收第二个参数，它是一个参数对象，有如下可选的参数:
    // delay: 可用于对效果函数进行去抖动的数字(以毫秒为单位)。如果是 0(默认值) 的话，那么不会进行去抖。
    // name: 字符串，用于在例如像 spy 这样事件中用作此 reaction 的名称。
    // onError: 用来处理 reaction 的错误，而不是传播它们。
    // scheduler: 设置自定义调度器以决定如何调度 autorun 函数的重新运行
    opts: IAutorunOptions = EMPTY_OBJECT
): IReactionDisposer {
    if (process.env.NODE_ENV !== "production") {
        invariant(typeof view === "function", "Autorun expects a function as first argument")
        invariant(
            isAction(view) === false,
            "Autorun does not accept actions since actions are untrackable"
        )
    }

    const name: string = (opts && opts.name) || (view as any).name || "Autorun@" + getNextId()
    const runSync = !opts.scheduler && !opts.delay
    let reaction: Reaction

    //同步模式
    if (runSync) {
        // normal autorun
        // Reaction类监督并控制任务的执行
        reaction = new Reaction(
            name,
            function(this: Reaction) {
                this.track(reactionRunner)
            },
            opts.onError
        )
        //自定义scheduler 或者设置了delay的情况
    } else {
        const scheduler = createSchedulerFromOptions(opts)
        // debounced autorun
        let isScheduled = false

        //第一步
        // Reaction类：监督并控制任务的执行
        reaction = new Reaction(
            name,
            () => {
                if (!isScheduled) {
                    isScheduled = true
                    scheduler(() => {
                        isScheduled = false
                        if (!reaction.isDisposed) reaction.track(reactionRunner)
                    })
                }
            },
            opts.onError
        )
    }

    //第二步
    function reactionRunner() {
        view(reaction)
    }
    //第三步
    reaction.schedule()
    return reaction.getDisposer()
}

export type IReactionOptions = IAutorunOptions & {
    fireImmediately?: boolean
    equals?: IEqualsComparer<any>
}

const run = (f: Lambda) => f()

function createSchedulerFromOptions(opts: IReactionOptions) {
    return opts.scheduler
        ? opts.scheduler
        : opts.delay
        ? (f: Lambda) => setTimeout(f, opts.delay!)
        : run
}

export function reaction<T>(
    expression: (r: IReactionPublic) => T,
    effect: (arg: T, r: IReactionPublic) => void,
    opts: IReactionOptions = EMPTY_OBJECT
): IReactionDisposer {
    if (typeof opts === "boolean") {
        opts = { fireImmediately: opts }
        deprecated(
            `Using fireImmediately as argument is deprecated. Use '{ fireImmediately: true }' instead`
        )
    }
    if (process.env.NODE_ENV !== "production") {
        invariant(
            typeof expression === "function",
            "First argument to reaction should be a function"
        )
        invariant(typeof opts === "object", "Third argument of reactions should be an object")
    }
    const name = opts.name || "Reaction@" + getNextId()
    const effectAction = action(
        name,
        opts.onError ? wrapErrorHandler(opts.onError, effect) : effect
    )
    const runSync = !opts.scheduler && !opts.delay
    const scheduler = createSchedulerFromOptions(opts)

    let firstTime = true
    let isScheduled = false
    let value: T

    const equals = (opts as any).compareStructural
        ? comparer.structural
        : opts.equals || comparer.default

    const r = new Reaction(
        name,
        () => {
            if (firstTime || runSync) {
                reactionRunner()
            } else if (!isScheduled) {
                isScheduled = true
                scheduler!(reactionRunner)
            }
        },
        opts.onError
    )

    function reactionRunner() {
        isScheduled = false // Q: move into reaction runner?
        if (r.isDisposed) return
        let changed = false
        r.track(() => {
            const nextValue = expression(r)
            changed = firstTime || !equals(value, nextValue)
            value = nextValue
        })
        if (firstTime && opts.fireImmediately!) effectAction(value, r)
        if (!firstTime && (changed as boolean) === true) effectAction(value, r)
        if (firstTime) firstTime = false
    }

    r.schedule()
    return r.getDisposer()
}

function wrapErrorHandler(errorHandler, baseFn) {
    return function() {
        try {
            return baseFn.apply(this, arguments)
        } catch (e) {
            errorHandler.call(this, e)
        }
    }
}
