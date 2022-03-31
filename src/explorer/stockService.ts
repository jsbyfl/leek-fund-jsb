import Axios from 'axios';
import { decode } from 'iconv-lite';
import { ExtensionContext, QuickPickItem, window } from 'vscode';
import globalState from '../globalState';
import { LeekTreeItem } from '../shared/leekTreeItem';
import { executeStocksRemind } from '../shared/remindNotification';
import { calcFixedPriceNumber, events, formatNumber, randHeader, sortData } from '../shared/utils';
import { LeekService } from './leekService';

export default class StockService extends LeekService {
  public stockList: Array<LeekTreeItem> = [];
  private context: ExtensionContext;
  private token: string = '';

  constructor(context: ExtensionContext) {
    super();
    this.context = context;
  }

  async getToken(): Promise<string> {
    if (this.token !== '') return this.token;

    const res = await Axios.get('https://xueqiu.com/');
    const cookies: string[] = res.headers['set-cookie'];

    const param: string = cookies.filter(key => key.includes('xq_a_token'))[0] || '';
    this.token = param.split(';')[0] || '';

    return this.token;
  }

  async getData(codes: Array<string>, order: number): Promise<Array<LeekTreeItem>> {
    // console.log('fetching stock data…');
    if ((codes && codes.length === 0) || !codes) {
      return [];
    }

    let _codes = codes.map((code) => (code.startsWith('cnf_') ? code.substr(4) : code));
    const hkCodes: Array<string> = []; // 港股单独请求雪球数据源
    _codes = _codes.filter((code) => {
      if (code.startsWith('hk')) {
        const _code = code.startsWith('hk0') ? code.replace('hk', '') : code.toUpperCase(); // 个股去掉'hk', 指数保留'hk'并转为大写
        hkCodes.push(_code);
        return false;
      } else {
        return true;
      }
    });

    let stockList: Array<LeekTreeItem> = [];
    let aStockCount = 0;
    let usStockCount = 0;
    let hkStockCount = 0;
    let cnfStockCount = 0;
    let noDataStockCount = 0;

    const url = `https://hq.sinajs.cn/list=${_codes.join(',')}`;
    try {
      if (_codes.length) {
        const resp = await Axios.get(url, {
          // axios 乱码解决
          responseType: 'arraybuffer',
          transformResponse: [
            (data) => {
              const body = decode(data, 'GB18030');
              return body;
            },
          ],
          headers: {
            ...randHeader(),
            Referer: 'http://finance.sina.com.cn/',
          },
        });
        if (/FAILED/.test(resp.data)) {
          if (_codes.length === 1) {
            window.showErrorMessage(
              `fail: error Stock code in ${_codes}, please delete error Stock code`
            );
            return [
              {
                id: _codes[0],
                type: '',
                contextValue: 'failed',
                isCategory: false,
                info: { code: _codes[0], percent: '0', name: '错误代码' },
                label: _codes[0] + ' 错误代码，请查看是否缺少交易所信息',
              },
            ];
          }
          for (const code of _codes) {
            stockList = stockList.concat(await this.getData(new Array(code), order));
          }
        } else {
          const splitData = resp.data.split(';\n');
          for (let i = 0; i < splitData.length - 1; i++) {
            const code = splitData[i].split('="')[0].split('var hq_str_')[1];
            const params = splitData[i].split('="')[1].split(',');
            let type = code.substr(0, 2) || 'sh';
            let symbol = code.substr(2);
            let stockItem: any;
            let fixedNumber = 2;
            if (params.length > 1) {
              if (/^(sh|sz)/.test(code)) {
                let open = params[1];
                let yestclose = params[2];
                let price = params[3];
                let high = params[4];
                let low = params[5];
                fixedNumber = calcFixedPriceNumber(open, yestclose, price, high, low);
                stockItem = {
                  code,
                  name: params[0],
                  open: formatNumber(open, fixedNumber, false),
                  yestclose: formatNumber(yestclose, fixedNumber, false),
                  price: formatNumber(price, fixedNumber, false),
                  low: formatNumber(low, fixedNumber, false),
                  high: formatNumber(high, fixedNumber, false),
                  volume: formatNumber(params[8], 2),
                  amount: formatNumber(params[9], 2),
                  time: `${params[30]} ${params[31]}`,
                  percent: '',
                };
                aStockCount += 1;
              } else if (/^gb_/.test(code)) {
                symbol = code.substr(3);
                let open = params[5];
                let yestclose = params[26];
                let price = params[1];
                let high = params[6];
                let low = params[7];
                fixedNumber = calcFixedPriceNumber(open, yestclose, price, high, low);
                stockItem = {
                  code,
                  name: params[0],
                  open: formatNumber(open, fixedNumber, false),
                  yestclose: formatNumber(yestclose, fixedNumber, false),
                  price: formatNumber(price, fixedNumber, false),
                  low: formatNumber(low, fixedNumber, false),
                  high: formatNumber(high, fixedNumber, false),
                  volume: formatNumber(params[10], 2),
                  amount: '接口无数据',
                  percent: '',
                };
                type = code.substr(0, 3);
                noDataStockCount += 1;
              } else if (/^usr_/.test(code)) {
                symbol = code.substr(4);
                let open = params[5];
                let yestclose = params[26];
                let price = params[1];
                let high = params[6];
                let low = params[7];
                fixedNumber = calcFixedPriceNumber(open, yestclose, price, high, low);
                stockItem = {
                  code,
                  name: params[0],
                  open: formatNumber(open, fixedNumber, false),
                  yestclose: formatNumber(yestclose, fixedNumber, false),
                  price: formatNumber(price, fixedNumber, false),
                  low: formatNumber(low, fixedNumber, false),
                  high: formatNumber(high, fixedNumber, false),
                  volume: formatNumber(params[10], 2),
                  amount: '接口无数据',
                  percent: '',
                };
                type = code.substr(0, 4);
                usStockCount += 1;
              } else if (/^[A-Z]/.test(code)) {
                // code 大写字母开头表示期货
                symbol = code;
                const _code = `cnf_${code}`;
                /* 解析格式，与股票略有不同
                var hq_str_V2201="PVC2201,230000,
                8585.00, 8692.00, 8467.00, 8641.00, // params[2,3,4,5] 开，高，低，昨收
                8673.00, 8674.00, // params[6, 7] 买一、卖一价
                8675.00, // 现价 params[8]
                8630.00, // 均价
                8821.00, // 昨日结算价【一般软件的行情涨跌幅按这个价格显示涨跌幅】（后续考虑配置项，设置按收盘价还是结算价显示涨跌幅）
                109, // 买一量
                2, // 卖一量
                289274, // 持仓量
                230643, //总量
                连, // params[8 + 7] 交易所名称 ["连","沪", "郑"]
                PVC,2021-11-26,1,9243.000,8611.000,9243.000,8251.000,9435.000,8108.000,13380.000,8108.000,445.541";
                */
                let name = params[0];
                let open = params[2];
                let high = params[3];
                let low = params[4];
                let yestclose = params[5];
                let price = params[8];
                let yestCallPrice = params[8 + 2];
                let volume = params[8 + 6]; // 成交量
                fixedNumber = calcFixedPriceNumber(open, yestclose, price, high, low);
                stockItem = {
                  code: _code,
                  name: name,
                  open: formatNumber(open, fixedNumber, false),
                  yestclose: formatNumber(yestclose, fixedNumber, false),
                  yestcallprice: formatNumber(yestCallPrice, fixedNumber, false),
                  price: formatNumber(price, fixedNumber, false),
                  low: formatNumber(low, fixedNumber, false),
                  high: formatNumber(high, fixedNumber, false),
                  volume: formatNumber(volume, 2),
                  amount: '接口无数据',
                  percent: '',
                };
                type = 'cnf_';
                cnfStockCount += 1;
              }
              if (stockItem) {
                const { yestclose, open } = stockItem;
                let { price } = stockItem;
                /*  if (open === price && price === '0.00') {
                stockItem.isStop = true;
              } */

                // 竞价阶段部分开盘和价格为0.00导致显示 -100%
                try {
                  if (Number(open) <= 0) {
                    price = yestclose;
                  }
                } catch (err) {
                  console.error(err);
                }
                stockItem.showLabel = this.showLabel;
                stockItem.isStock = true;
                stockItem.type = type;
                stockItem.symbol = symbol;
                stockItem.updown = formatNumber(+price - +yestclose, fixedNumber, false);
                stockItem.percent =
                  (stockItem.updown >= 0 ? '+' : '-') +
                  formatNumber((Math.abs(stockItem.updown) / +yestclose) * 100, 2, false);

                const treeItem = new LeekTreeItem(stockItem, this.context);
                stockList.push(treeItem);
              }
            } else {
              // 接口不支持的
              noDataStockCount += 1;
              stockItem = {
                id: code,
                name: `接口不支持该股票 ${code}`,
                showLabel: this.showLabel,
                isStock: true,
                percent: '',
                type: 'nodata',
                contextValue: 'nodata',
              };
              const treeItem = new LeekTreeItem(stockItem, this.context);
              stockList.push(treeItem);
            }
          }
        }
      }
    } catch (err) {
      console.info(url);
      console.error(err);
      if (globalState.showStockErrorInfo) {
        window.showErrorMessage(`fail: Stock error ` + url);
        globalState.showStockErrorInfo = false;
        globalState.telemetry.sendEvent('error: stockService', {
          url,
          error: err,
        });
      }
    }

    const hkUrl = `https://stock.xueqiu.com/v5/stock/batch/quote.json?symbol=${hkCodes.join(',')}`;
    try {
      if (hkCodes.length) {
        const hkResp = await Axios.get(hkUrl, {
          responseType: 'text',
          transformResponse: [
            (data) => {
              const body = JSON.parse(data);
              return body;
            },
          ],
          headers: {
            ...randHeader(),
            Referer: 'https://stock.xueqiu.com/',
            Cookie: await this.getToken(),
          },
        });
        const { data, error_code, error_description } = hkResp.data;
        if (error_code) {
          if (hkCodes.length === 1) {
            window.showErrorMessage(`fail: a HK Stock request error has occured.(${error_code}, ${error_description})`);
            return [
              {
                id: hkCodes[0],
                type: '',
                contextValue: 'failed',
                isCategory: false,
                info: { code: hkCodes[0], percent: '0', name: '错误代码' },
                label: hkCodes[0] + ' 错误代码，请查看是否缺少交易所信息',
              },
            ];
          }
          for (const code of hkCodes) {
            const _code = code.startsWith('HK') ? code.replace('HK', 'hk') : 'hk' + code; // 指数以'HK'开头需要转为‘hk’, 个股需要前补'hk'
            stockList = stockList.concat(await this.getData(new Array(_code), order));
          }
        } else {
          const stocks = data.items || [];
          stocks.forEach((item: any) => {
            const quote = item.quote;
            let open = quote.open?.toString() || '0';
            let yestclose = quote.last_close?.toString() || '0';
            let price = quote.current?.toString() || '0';
            let high = quote.high?.toString() || '0';
            let low = quote.low?.toString() || '0';
            const fixedNumber = calcFixedPriceNumber(open, yestclose, price, high, low);
            const stockItem: any = {
              code: quote.symbol.startsWith('HK') ? quote.symbol.replace('HK', 'hk') : 'hk' + quote.symbol,
              name: quote.name,
              open: formatNumber(open, fixedNumber, false),
              yestclose: formatNumber(yestclose, fixedNumber, false),
              price: formatNumber(price, fixedNumber, false),
              low: formatNumber(low, fixedNumber, false),
              high: formatNumber(high, fixedNumber, false),
              volume: formatNumber(quote.volume || 0, 2),
              amount: formatNumber(quote.amount || 0, 2),
              percent: '',
            };
            hkStockCount += 1;
            if (stockItem) {
              const { yestclose, open } = stockItem;
              let { price } = stockItem;
              // 竞价阶段部分开盘和价格为0.00导致显示 -100%
              if (Number(open) <= 0) {
                price = yestclose;
              }
              stockItem.showLabel = this.showLabel;
              stockItem.isStock = true;
              stockItem.type = 'hk';
              stockItem.symbol = quote.code;
              stockItem.updown = formatNumber(+price - +yestclose, fixedNumber, false);
              stockItem.percent =
                (stockItem.updown >= 0 ? '+' : '-') +
                formatNumber((Math.abs(stockItem.updown) / +yestclose) * 100, 2, false);

              const treeItem = new LeekTreeItem(stockItem, this.context);
              stockList.push(treeItem);
            }
          });
        }
      }
    } catch (err) {
      console.info(hkUrl);
      console.error(err);
      if (globalState.showStockErrorInfo) {
        window.showErrorMessage(`fail: HK Stock error ` + hkUrl);
        globalState.showStockErrorInfo = false;
        globalState.telemetry.sendEvent('error: stockService', {
          hkUrl,
          error: err,
        });
      }
    }

    const res = sortData(stockList, order);
    executeStocksRemind(res, this.stockList);
    const oldStockList = this.stockList;
    this.stockList = res;
    events.emit('stockListUpdate', this.stockList, oldStockList);
    globalState.aStockCount = aStockCount;
    globalState.hkStockCount = hkStockCount;
    globalState.usStockCount = usStockCount;
    globalState.cnfStockCount = cnfStockCount;
    globalState.noDataStockCount = noDataStockCount;
    return res;
  }

  // https://github.com/LeekHub/leek-fund/issues/266
  async getStockSuggestList(searchText = ''): Promise<QuickPickItem[]> {
    if (!searchText) {
      return [{ label: '请输入关键词查询，如：0000001 或 上证指数' }];
    }

    const result: QuickPickItem[] = [];

    // 期货大写字母开头
    const isFuture = /^[A-Z]/.test(searchText[0]);
    if (isFuture) {
      //期货使用新浪数据源
      const type = '85,86,88';
      const futureUrl = `http://suggest3.sinajs.cn/suggest/type=${type}&key=${encodeURIComponent(searchText)}`;
      try {
        console.log('getFutureSuggestList: getting...');
        const futureResponse = await Axios.get(futureUrl, {
          responseType: 'arraybuffer',
          transformResponse: [
            (data) => {
              const body = decode(data, 'GB18030');
              return body;
            },
          ],
          headers: randHeader(),
        });
        const text = futureResponse.data.slice(18, -2);
        if (text === '') {
          return result;
        }
        const tempArr = text.split(';');
        tempArr.forEach((item: string) => {
          const arr = item.split(',');
          let code = arr[3];
          // if (code.substr(0, 2) === 'of') {
          // 修改lof以及etf的前缀，防止被过滤
          // http://www.csisc.cn/zbscbzw/cpbmjj/201212/f3263ab61f7c4dba8461ebbd9d0c6755.shtml
          // 在上海证券交易所挂牌的证券投资基金使用50～59开头6位数字编码，在深圳证券交易所挂牌的证券投资基金使用15～19开头6位数字编码。
          // code = code.replace(/^(of)(5[0-9])/g, 'sh$2').replace(/^(of)(1[5-9])/g, 'sz$2');
          // }

          // 期货 suggest 请求返回的 code 小写开头改为大写
          code = code.toUpperCase();

          // if (code === 'hkhsi' || code === 'hkhscei' || isFuture) {
          //   code = code.toUpperCase().replace('HK', 'hk');
          // }

          // 过滤多余的 us. 开头的股干扰
          // if ((STOCK_TYPE.includes(code.substr(0, 2)) && !code.startsWith('us.')) || isFuture) {
          result.push({
            label: `${code} | ${arr[4]}`,
            description: arr[7] && arr[7].replace(/"/g, ''),
          });
          // }
        });
        return result;
      } catch (err) {
        console.log(futureUrl);
        console.error(err);
        return [{ label: '期货查询失败，请重试' }];
      }
    } else {
      //股票使用雪球数据源
      const stockUrl = `https://xueqiu.com/stock/search.json?code=${encodeURIComponent(searchText)}`;
      try {
        console.log('getStockSuggestList: getting...');
        const stockResponse = await Axios.get(stockUrl, {
          responseType: 'text',
          transformResponse: [
            (data) => {
              const body = JSON.parse(data);
              return body;
            },
          ],
          headers: {
            ...randHeader(),
            Referer: 'https://stock.xueqiu.com/',
            Cookie: await this.getToken(),
          },
        });
        const stocks = stockResponse.data.stocks || [];
        stocks.forEach((item: any) => {
          const { code, name } = item;
          if (code.startsWith('SH') || code.startsWith('SZ')) {
            const _code = code.toLowerCase();
            result.push({
              label: `${_code} | ${name}`,
              description: `A股`,
            });
          } else if (/^0\d{4}$/.test(code) || /^HK[A-Z].*/.test(code)) { // 港股个股 || 港股指数
            const _code = code.startsWith('HK') ? code.replace('HK', 'hk') : 'hk' + code;
            result.push({
              label: `${_code} | ${name}`,
              description: `港股`,
            });
          } else if (/\.?[A-Z]*[A-Z]$/.test(code)) {
            const _code = 'us' + code.toLowerCase().replace('.', ''); // 去除美股指数前面的'.'
            result.push({
              label: `${_code} | ${name}`,
              description: `美股`,
            });
          }
        });
        return result;
      } catch (err) {
        console.log(stockUrl);
        console.error(err);
        return [{ label: '股票查询失败，请重试' }];
      }
    }
  }
}
