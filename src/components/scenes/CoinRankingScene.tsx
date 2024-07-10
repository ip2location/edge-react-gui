import * as React from 'react'
import { ListRenderItemInfo, View } from 'react-native'
import Animated from 'react-native-reanimated'

import { checkEnabledExchanges } from '../../actions/SettingsActions'
import { SCROLL_INDICATOR_INSET_FIX } from '../../constants/constantSettings'
import { useAsyncEffect } from '../../hooks/useAsyncEffect'
import { useHandler } from '../../hooks/useHandler'
import { lstrings } from '../../locales/strings'
import { getDefaultFiat } from '../../selectors/SettingsSelectors'
import { FooterRender } from '../../state/SceneFooterState'
import { useSceneScrollHandler } from '../../state/SceneScrollState'
import { asCoinranking, AssetSubText, CoinRanking, PercentChangeTimeFrame } from '../../types/coinrankTypes'
import { useState } from '../../types/reactHooks'
import { useDispatch, useSelector } from '../../types/reactRedux'
import { EdgeSceneProps } from '../../types/routerTypes'
import { debugLog, enableDebugLogType, LOG_COINRANK } from '../../util/logger'
import { fetchRates } from '../../util/network'
import { EdgeAnim, MAX_LIST_ITEMS_ANIM } from '../common/EdgeAnim'
import { EdgeTouchableOpacity } from '../common/EdgeTouchableOpacity'
import { SceneWrapper } from '../common/SceneWrapper'
import { CoinRankRow } from '../data/row/CoinRankRow'
import { showDevError } from '../services/AirshipInstance'
import { cacheStyles, Theme, useTheme } from '../services/ThemeContext'
import { DividerLine } from '../themed/DividerLine'
import { EdgeText } from '../themed/EdgeText'
import { SearchFooter } from '../themed/SearchFooter'

const coinRanking: CoinRanking = { coinRankingDatas: [] }

const QUERY_PAGE_SIZE = 30
const LISTINGS_REFRESH_INTERVAL = 30000

// Masking enable bit with 0 disables logging
enableDebugLogType(LOG_COINRANK & 0)

interface Props extends EdgeSceneProps<'coinRanking'> {}

const percentChangeOrder: PercentChangeTimeFrame[] = ['hours1', 'hours24', 'days7', 'days30', 'year1']
const percentChangeStrings: { [pc: string]: string } = {
  hours1: '1hr',
  hours24: '24hr',
  days7: '7d',
  days30: '30d',
  year1: '1y'
}
const assetSubTextStrings: { [pc: string]: string } = {
  marketCap: lstrings.coin_rank_market_cap_abbreviation,
  volume24h: lstrings.coin_rank_volume_24hr_abbreviation
}

type Timeout = ReturnType<typeof setTimeout>
const CoinRankingComponent = (props: Props) => {
  const theme = useTheme()
  const styles = getStyles(theme)
  const { navigation } = props
  const dispatch = useDispatch()

  const defaultIsoFiat = useSelector(state => `iso:${getDefaultFiat(state)}`)
  const [lastUsedFiat, setLastUsedFiat] = useState<string>(defaultIsoFiat)

  const mounted = React.useRef<boolean>(true)
  const timeoutHandler = React.useRef<Timeout | undefined>()

  const [requestDataSize, setRequestDataSize] = useState<number>(QUERY_PAGE_SIZE)
  const [dataSize, setDataSize] = useState<number>(0)
  const [searchText, setSearchText] = useState<string>('')
  const [isSearching, setIsSearching] = useState<boolean>(false)
  const [percentChangeTimeFrame, setPercentChangeTimeFrame] = useState<PercentChangeTimeFrame>('hours24')
  const [assetSubText, setPriceSubText] = useState<AssetSubText>('marketCap')
  const [footerHeight, setFooterHeight] = React.useState<number | undefined>()

  const handleScroll = useSceneScrollHandler()

  const extraData = React.useMemo(() => ({ assetSubText, lastUsedFiat, percentChangeTimeFrame }), [assetSubText, lastUsedFiat, percentChangeTimeFrame])

  const { coinRankingDatas } = coinRanking

  const renderItem = (itemObj: ListRenderItemInfo<number>) => {
    const { index, item } = itemObj
    const currencyCode = coinRankingDatas[index]?.currencyCode ?? 'NO_CURRENCY_CODE'
    const rank = coinRankingDatas[index]?.rank ?? 'NO_RANK'
    const key = `${index}-${item}-${rank}-${currencyCode}-${lastUsedFiat}`
    debugLog(LOG_COINRANK, `renderItem ${key.toString()}`)

    return (
      <EdgeAnim disableAnimation={index >= MAX_LIST_ITEMS_ANIM} enter={{ type: 'fadeInDown', distance: 20 * (index + 1) }}>
        <CoinRankRow
          navigation={navigation}
          index={item}
          key={key}
          coinRanking={coinRanking}
          percentChangeTimeFrame={percentChangeTimeFrame}
          assetSubText={assetSubText}
        />
      </EdgeAnim>
    )
  }

  const handleEndReached = useHandler(() => {
    debugLog(LOG_COINRANK, `handleEndReached. setRequestDataSize ${requestDataSize + QUERY_PAGE_SIZE}`)
    setRequestDataSize(requestDataSize + QUERY_PAGE_SIZE)
  })

  const handlePercentChange = useHandler(() => {
    const index = percentChangeOrder.indexOf(percentChangeTimeFrame)
    if (index < 0) {
      const msg = `Invalid percent change value ${percentChangeTimeFrame}`
      console.error(msg)
      showDevError(msg)
      return
    }
    const newIndex = index + 1 >= percentChangeOrder.length ? 0 : index + 1
    const newTimeFrame = percentChangeOrder[newIndex]
    setPercentChangeTimeFrame(newTimeFrame)
  })

  const handlePriceSubText = useHandler(() => {
    const newPriceSubText = assetSubText === 'marketCap' ? 'volume24h' : 'marketCap'
    setPriceSubText(newPriceSubText)
  })

  const handleStartSearching = useHandler(() => {
    setIsSearching(true)
  })

  const handleDoneSearching = useHandler(() => {
    setSearchText('')
    setIsSearching(false)
  })

  const handleChangeText = useHandler((value: string) => {
    setSearchText(value)
  })

  const handleFooterLayoutHeight = useHandler((height: number) => {
    setFooterHeight(height)
  })

  React.useEffect(() => {
    return () => {
      if (timeoutHandler.current != null) {
        clearTimeout(timeoutHandler.current)
      }
      mounted.current = false
    }
  }, [])

  React.useEffect(() => {
    return navigation.addListener('focus', () => {
      dispatch(checkEnabledExchanges())
    })
  }, [dispatch, navigation])

  useAsyncEffect(
    async () => {
      const queryLoop = async () => {
        try {
          let start = 1
          debugLog(LOG_COINRANK, `queryLoop ${defaultIsoFiat} dataSize=${dataSize} requestDataSize=${requestDataSize}`)
          while (start < requestDataSize) {
            const url = `v2/coinrank?fiatCode=${defaultIsoFiat}&start=${start}&length=${QUERY_PAGE_SIZE}`
            const response = await fetchRates(url)
            if (!response.ok) {
              const text = await response.text()
              console.warn(text)
              break
            }
            const replyJson = await response.json()
            const listings = asCoinranking(replyJson)
            for (let i = 0; i < listings.data.length; i++) {
              const rankIndex = start - 1 + i
              const row = listings.data[i]
              coinRankingDatas[rankIndex] = row
              debugLog(LOG_COINRANK, `queryLoop: ${rankIndex.toString()} ${row.rank} ${row.currencyCode}`)
            }
            start += QUERY_PAGE_SIZE
          }
          setDataSize(coinRankingDatas.length)
          if (lastUsedFiat !== defaultIsoFiat) {
            setLastUsedFiat(defaultIsoFiat)
          }
        } catch (e: any) {
          console.warn(e.message)
        }
        timeoutHandler.current = setTimeout(queryLoop, LISTINGS_REFRESH_INTERVAL)
      }
      if (timeoutHandler.current != null) {
        clearTimeout(timeoutHandler.current)
      }
      queryLoop().catch(e => debugLog(LOG_COINRANK, e.message))
    },
    [requestDataSize, defaultIsoFiat],
    'CoinRankingComponent'
  )

  const listdata: number[] = React.useMemo(() => {
    debugLog(LOG_COINRANK, `Updating listdata dataSize=${dataSize} searchText=${searchText}`)
    const out = []
    for (let i = 0; i < dataSize; i++) {
      const cr = coinRankingDatas[i]
      if (searchText === '') {
        out.push(i)
      } else {
        if (cr.currencyCode.toLowerCase().includes(searchText.toLowerCase()) || cr.currencyName.toLowerCase().includes(searchText.toLowerCase())) {
          out.push(i)
        }
      }
    }
    return out

    // Do not re-render on change of coinRankings. This is intended to be
    // asynchronously accessed by each individual row.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSize, searchText])

  const timeFrameString = percentChangeStrings[percentChangeTimeFrame]
  const assetSubTextString = assetSubTextStrings[assetSubText]

  const renderFooter: FooterRender = React.useCallback(
    sceneWrapperInfo => {
      return (
        <SearchFooter
          name="CoinRankingScene-SearchFooter"
          placeholder={lstrings.search_assets}
          isSearching={isSearching}
          searchText={searchText}
          sceneWrapperInfo={sceneWrapperInfo}
          onStartSearching={handleStartSearching}
          onDoneSearching={handleDoneSearching}
          onChangeText={handleChangeText}
          onLayoutHeight={handleFooterLayoutHeight}
        />
      )
    },
    [handleChangeText, handleDoneSearching, handleFooterLayoutHeight, handleStartSearching, isSearching, searchText]
  )

  return (
    <SceneWrapper avoidKeyboard footerHeight={footerHeight} hasNotifications renderFooter={renderFooter}>
      {({ insetStyle, undoInsetStyle }) => (
        <>
          <View style={styles.headerContainer}>
            <View style={styles.rankView}>
              <EdgeText style={styles.rankText}>{lstrings.coin_rank_rank}</EdgeText>
            </View>
            <EdgeTouchableOpacity style={styles.assetView} onPress={handlePriceSubText}>
              <EdgeText style={styles.assetText}>{assetSubTextString}</EdgeText>
            </EdgeTouchableOpacity>
            <EdgeTouchableOpacity style={styles.percentChangeView} onPress={handlePercentChange}>
              <EdgeText style={styles.percentChangeText}>{timeFrameString}</EdgeText>
            </EdgeTouchableOpacity>
            <View style={styles.priceView}>
              <EdgeText style={styles.priceText}>{lstrings.coin_rank_price}</EdgeText>
            </View>
          </View>
          <DividerLine marginRem={[0, 0, 0, 1]} />
          <View style={{ ...undoInsetStyle, marginTop: 0 }}>
            <Animated.FlatList
              contentContainerStyle={{ ...insetStyle, paddingTop: 0 }}
              data={listdata}
              extraData={extraData}
              keyboardDismissMode="on-drag"
              onEndReachedThreshold={1}
              onEndReached={handleEndReached}
              onScroll={handleScroll}
              renderItem={renderItem}
              scrollIndicatorInsets={SCROLL_INDICATOR_INSET_FIX}
            />
          </View>
        </>
      )}
    </SceneWrapper>
  )
}

export const CoinRankingScene = React.memo(CoinRankingComponent)

const getStyles = cacheStyles((theme: Theme) => {
  const baseTextStyle = {
    fontSize: theme.rem(0.75)
  }
  const baseTextView = {
    height: theme.rem(2)
  }

  return {
    headerContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      marginLeft: theme.rem(1),
      paddingRight: theme.rem(1)
    },
    searchDoneButton: {
      justifyContent: 'center',
      paddingLeft: theme.rem(0.75)
    },
    rankView: {
      ...baseTextView,
      justifyContent: 'center',
      width: theme.rem(5.25)
    },
    rankText: {
      ...baseTextStyle
    },
    assetView: {
      ...baseTextView,
      justifyContent: 'center',
      width: theme.rem(4.75)
    },
    assetText: {
      ...baseTextStyle,
      color: theme.textLink
    },
    percentChangeView: {
      ...baseTextView,
      justifyContent: 'center',
      width: theme.rem(4)
    },
    percentChangeText: {
      ...baseTextStyle,
      color: theme.textLink
    },
    priceView: {
      ...baseTextView,
      justifyContent: 'center',
      flex: 1
    },
    priceText: {
      ...baseTextStyle,
      textAlign: 'right'
    },
    tappableHeaderText: {
      color: theme.textLink
    }
  }
})
