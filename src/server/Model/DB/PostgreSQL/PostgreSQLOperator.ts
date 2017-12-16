import * as pg from 'pg';
import DBOperator from '../DBOperator';
import Util from '../../../Util/Util';

/**
* PostgreSQLOperator クラス
*/
class PostgreSQLOperator extends DBOperator {
    protected static pool: pg.Pool | null = null;

    /**
    * get Pool
    * @return Pool
    */
    public getPool(): pg.Pool {
        if(PostgreSQLOperator.pool === null) {
            let config = this.config.getConfig().postgres;
            if(typeof config.idleTimeoutMillis === 'undefined') { config.idleTimeoutMillis = 5000; }
            PostgreSQLOperator.pool = new pg.Pool(config);
        }

        return PostgreSQLOperator.pool;
    }

    /**
    * ping
    * @return Promise<void>
    */
    public async ping(): Promise<void> {
        await this.runQuery('select 1;');
    }

    /**
    * end
    * @return Promise<void>
    */
    public end(): Promise<void> {
        return this.getPool().end()
        .then(() => {
            PostgreSQLOperator.pool = null;
        });
    }

    /**
    * query を実行する
    * @param query
    * @return Promise<T>
    */
    public async runQuery<T>(query: string, values?: any): Promise<T> {
        const client = await this.getPool().connect();

        let result: pg.QueryResult;
        try {
            if(typeof values === 'undefined') {
                result = await client.query(query);
            } else {
                result = await client.query(query, values);
            }
            client.release();
        } catch(err) {
            client.release();
            throw err;
        }

        return <T>(<any>result.rows);
    }

    /**
    * 大量のデータをインサートする
    * @param deleteTableName レコードを削除するテーブルの名前
    * @param datas インサートするデータ
    * @param isDelete: データを削除するか true: 削除, false: 削除しない
    * @param insertWait インサート時の wait (ms)
    * @return Promise<pg.QueryResult>
    */
    public manyInsert(deleteTableName: string, datas: { query: string, values?: any[] }[], isDelete: boolean, insertWait: number = 0): Promise<void> {
        return new Promise<void>(async (resolve: () => void, reject: (err: Error) => void) => {
            this.getPool().connect(async (err: Error, client: pg.Client, done: () => void) => {
                if(err) {
                    this.log.system.error('connect error');
                    this.log.system.error(err.message);
                    reject(err);
                    return;
                }

                const failed = async (err: Error) => {
                    await client.query('rollback')
                    .catch((e) => {
                        this.log.system.fatal('rollback error');
                        this.log.system.fatal(e);
                    });

                    done();
                    this.log.system.error(err.message);
                    reject(err);
                }

                // transaction 開始
                try {
                    await client.query('begin');
                } catch(err) {
                    this.log.system.error('transaction begin error');
                    await failed(err);
                    return;
                }

                if(isDelete) {
                    // table を削除する
                    try {
                        await client.query(`delete from ${ deleteTableName }`);
                    } catch(err) {
                        await failed(err);
                        return;
                    }
                }

                // insert data
                for(let data of datas) {
                    try {
                        if(typeof data.values === 'undefined') {
                            await client.query(data.query);
                        } else {
                            await client.query(data.query, data.values);
                        }
                    } catch(err) {
                        await failed(err);
                        return;
                    }

                    if(insertWait > 0) { await Util.sleep(insertWait); }
                }

                // commit
                try {
                    client.query('commit');
                } catch(err) {
                    this.log.system.error('transaction commit error');
                    await failed(err);
                    return;
                }

                done();
                resolve();
            });
        });
    }

    /**
    * insert with insertId
    * @param query
    * @param value
    * @return Promise<number> insertId
    */
    public async runInsert(query: string, values?: any): Promise<number> {
        const client = await this.getPool().connect();

        let result: pg.QueryResult;
        try {
            if(typeof values === 'undefined') {
                result = await client.query(query);
            } else {
                result = await client.query(query, values);
            }
            client.release();
        } catch(err) {
            client.release();
            throw err;
        }

        return result.oid;
    }
}

export default PostgreSQLOperator;
