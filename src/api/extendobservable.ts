import { isObservableMap } from "../types/observablemap"
import { asObservableObject } from "../types/observableobject"
import { isObservable } from "./isobservable"
import { invariant, deprecated, fail } from "../utils/utils"
import { startBatch, endBatch } from "../core/observable"
import {
    CreateObservableOptions,
    asCreateObservableOptions,
    shallowCreateObservableOptions,
    deepDecorator,
    refDecorator
} from "./observable"
import { isComputed } from "./iscomputed"
import { computedDecorator } from "./computed"

export function extendShallowObservable<A extends Object, B extends Object>(
    target: A,
    properties: B,
    decorators?: { [K in keyof B]?: Function }
): A & B {
    deprecated(
        "'extendShallowObservable' is deprecated, use 'extendObservable(target, props, { deep: false })' instead"
    )
    return extendObservable(target, properties, decorators, shallowCreateObservableOptions)
}

// 必须接收 2 ~ 4 个参数 第一个参数必须是对象，比如 bankUser 第二个参数是属性名，比如 name
// 第三个参数是 装饰器 配置项。第四个参数是配置选项对象
// 一般只有target === {}, properties === v 这两个参数
export function extendObservable<A extends Object, B extends Object>(
    target: A,
    properties: B,
    decorators?: { [K in keyof B]?: Function },
    options?: CreateObservableOptions
): A & B {
    if (process.env.NODE_ENV !== "production") {
        invariant(
            arguments.length >= 2 && arguments.length <= 4,
            "'extendObservable' expected 2-4 arguments"
        )
        invariant(
            typeof target === "object",
            "'extendObservable' expects an object as first argument"
        )
        invariant(
            !isObservableMap(target),
            "'extendObservable' should not be used on maps, use map.merge instead"
        )
        invariant(
            !isObservable(properties),
            "Extending an object with another observable (object) is not supported. Please construct an explicit propertymap, using `toJS` if need. See issue #540"
        )
        if (decorators)
            for (let key in decorators)
                if (!(key in properties))
                    fail(`Trying to declare a decorator for unspecified property '${key}'`)
    }
    //格式化入参
    options = asCreateObservableOptions(options)
    const defaultDecorator =
        options.defaultDecorator || (options.deep === false ? refDecorator : deepDecorator)

    //第一步 调用 asObservableObject 方法给 target 添加 $mobx 属性
    //$mobx 对象中的 values 属性，刚初始化的时候该属性是 {} 空对象
    //$mobx.values的内容是在接下来要讲的第二步中所形成的
    asObservableObject(target, options.name, defaultDecorator.enhancer) // make sure object is observable, even without initial props

    // 第二步 循环遍历，将属性经过 decorator(装饰器) 改造后添加到 target 上 默认的decorator 是 deepDecorator
    // 改造 === new observablevlaue
    startBatch()
    try {
        for (let key in properties) {
            const descriptor = Object.getOwnPropertyDescriptor(properties, key)!
            if (process.env.NODE_ENV !== "production") {
                if (Object.getOwnPropertyDescriptor(target, key))
                    fail(
                        `'extendObservable' can only be used to introduce new properties. Use 'set' or 'decorate' instead. The property '${key}' already exists on '${target}'`
                    )
                if (isComputed(descriptor.value))
                    fail(
                        `Passing a 'computed' as initial property value is no longer supported by extendObservable. Use a getter or decorator instead`
                    )
            }
            const decorator =
                decorators && key in decorators
                    ? decorators[key]
                    : descriptor.get
                    ? computedDecorator
                    : defaultDecorator
            if (process.env.NODE_ENV !== "production" && typeof decorator !== "function")
                return fail(`Not a valid decorator for '${key}', got: ${decorator}`)

            const resultDescriptor = decorator!(target, key, descriptor, true)
            if (
                resultDescriptor // otherwise, assume already applied, due to `applyToInstance`
            )
                Object.defineProperty(target, key, resultDescriptor)
        }
    } finally {
        endBatch()
    }
    return target as any
}
