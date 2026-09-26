/**
 * Nirman Mitra — Conditional Writes
 * putItem() in utils/dynamodb.js always overwrites. Writes that must happen at most once
 * (one check-in per day, webhook de-duplication) use a conditional PutCommand instead, so two
 * concurrent requests cannot both succeed.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import config, { isDemoMode } from '../utils/config.js';
import { getItem, putItem } from '../utils/dynamodb.js';

const IS_DEMO = isDemoMode();
const docClient = IS_DEMO ? null : DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: config.aws.region }),
  { marshallOptions: { removeUndefinedValues: true } },
);

/**
 * Put an item only if no item with the same primary key exists.
 * @param {string} tableName
 * @param {object} item
 * @param {object} key - Primary key of the item, e.g. { worker_id, log_date }
 * @param {object} [options]
 * @param {{attr: string, value: *}} [options.replaceIf] - Also overwrite an existing item whose attr equals value
 * @returns {Promise<boolean>} true if written, false if an item already existed
 */
export async function putItemIfAbsent(tableName, item, key, { replaceIf } = {}) {
  if (IS_DEMO) {
    // In-memory store is single-process, so read-then-write is good enough locally
    const existing = await getItem(tableName, key);
    if (existing && !(replaceIf && existing[replaceIf.attr] === replaceIf.value)) return false;
    await putItem(tableName, item);
    return true;
  }

  const params = {
    TableName: tableName,
    Item: item,
    ConditionExpression: `attribute_not_exists(${Object.keys(key)[0]})`,
  };
  if (replaceIf) {
    params.ConditionExpression += ' OR #replace_attr = :replace_value';
    params.ExpressionAttributeNames = { '#replace_attr': replaceIf.attr };
    params.ExpressionAttributeValues = { ':replace_value': replaceIf.value };
  }

  try {
    await docClient.send(new PutCommand(params));
    return true;
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return false;
    throw err;
  }
}

export default { putItemIfAbsent };
