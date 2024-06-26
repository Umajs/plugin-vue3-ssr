import { IContext, TPlugin, Result as R, Uma, TPluginConfig } from '@umajs/core';
import * as engineSource from 'consolidate';
import * as getStream from 'get-stream';
import Srejs from '@srejs/vue3';

interface TviewOptions{
    ssr?: boolean, // 全局开启服务端渲染
    cache?: boolean, // 全局使用服务端渲染缓存
    useEngine?:boolean // 渲染自定义html的页面组件时，选择性开启使用模板引擎
}

export interface TssrPluginOptions extends TviewOptions {
    rootDir?:string, // 客户端页面组件根文件夹
    rootNode?:string, // 客户端页面挂载根元素ID
    defaultRouter?:boolean, // 开启默认文件路由
    prefixCDN?:string, // 构建后静态资源CDN地址前缀
    prefixRouter?:string // 默认页面路由前缀(在defaultRouter设置为true时有效)
}

interface IvueViewParms{
    viewName :string;
    initProps : any,
    options:TviewOptions
}
export class Result<T> extends R<T> {
    /**
     *
     * @param viewName 页面标识
     * @param initProps 初始化数据上下文(模板和组件props可直接接收)，如果传递state则自动注入到vuex初始化state中
     * @param options 页面组件标识
     * @returns
     */
    static vue(viewName: string, initProps?: any, options?:TviewOptions) {
        return new Result<IvueViewParms>({
            type: 'vueView',
            data: {
                viewName,
                initProps,
                options,
            },
        });
    }
}
const NODE_ENV = (process.env && process.env.NODE_ENV) || 'development';
let SrejsInstance;

/** 插件配置读取放到了@srejs/vue3框架中进行兼容，在生产环境部署前构建阶段不会执行插件 */
let opt:TssrPluginOptions = Uma.config?.ssr || {}; // ssr.config.ts
const vueSsrPlugin = <TPluginConfig>Uma.config?.plugin?.vue3 || <TPluginConfig>Uma.config?.plugin['vue3-ssr'];

if (vueSsrPlugin?.options) {
    opt = vueSsrPlugin.options;
}

let defaultRouter = false;

// eslint-disable-next-line no-prototype-builtins
if (opt.hasOwnProperty('defaultRouter')) {
    defaultRouter = opt.defaultRouter;
}

try {
    SrejsInstance = new Srejs(Uma.app, NODE_ENV === 'development', defaultRouter, opt);
} catch (error) {
    console.error(error);
}

const renderView = async (ctx:IContext, viewName:string, initProps?:any, options?:TviewOptions) => {
    const mergeProps = Object.assign(ctx.state || {}, initProps);
    let html = await SrejsInstance.render(ctx, viewName, mergeProps, options);

    const viewPlugin = <TPluginConfig>Uma.config?.plugin.views; // use @umajs/plugin-views

    if (viewPlugin?.enable && options.useEngine) {
        const { opts } = viewPlugin.options;
        const { map } = opts;
        const engineName = map?.html;

        console.assert(engineName, '@umajs/plugin-views must be setting; eg====>  map:{html:"nunjucks"}');
        const engine = engineSource[engineName];
        const state = { ...options, ...mergeProps };

        if (typeof html === 'object' && html.readable && options.cache) {
            // when cache model ,html return a file stream
            html = await getStream(html);
        }

        // 在SSR模式中, 将__SSR_DATA_匹配出来, 避免其中内容被模板引擎执行, 避免注入类攻击
        const ssrReg = new RegExp(/<script[^>]*>window.__SSR_DATA__=([\s\S]*?)<\/script>/);
        const placeholderStr = '<!--plAcehoLder-->';
        const ssrScriptStr = html.match?.(ssrReg)?.[0] || '';
        const renderHtml = html.replace(ssrReg, placeholderStr); // without ssr script

        // engine rendering
        html = await engine.render(renderHtml, state);
        // final result
        html = html.replace(placeholderStr, ssrScriptStr);
    }

    ctx.type = 'text/html';
    ctx.body = html;
};

export default (): TPlugin => ({
    results: {
        async vueView(ctx: IContext, data: IvueViewParms) {
            const {
                viewName,
                initProps = {},
                options = {},
            } = data;

            await renderView(ctx, viewName, initProps, options);
        },
    },
    context: {
        async vue(viewName:string, initProps?:any, options?:TviewOptions) {
            await renderView(this, viewName, initProps, options);
        },
    },

});
